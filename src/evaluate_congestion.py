"""
evaluate_congestion.py
======================
Comprehensive evaluation of link utilization forecasting (regression)
and congestion detection (classification) on validation and test splits.

Methodology:
------------
1. Continuous Forecast: Models forecast utilization % (0-100 scale).
2. Congestion Classification: Derived by applying the policy threshold
   (utilization_pct > high_threshold, default 50.0%).
   Note: The dataset column 'target_congestion' is identically 0 across splits;
   congestion is derived purely from the continuous target exceeding 50.0%.
3. Imbalance Awareness: With ~0.6% test congestion prevalence, raw accuracy is
   misleading. We compute balanced accuracy, MCC, Precision, Recall, Specificity,
   F1, PR-AUC, and full confusion matrices.
4. Validation Split Options:
   - By default, uses first 2,000 chronological validation samples (0 congested).
   - Use --full-val to evaluate on the entire validation split (180,900 samples)
     to measure validation classification performance before touching the test set.
"""

import argparse
import json
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import torch
import yaml
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    confusion_matrix,
    ConfusionMatrixDisplay,
    matthews_corrcoef,
    precision_recall_curve,
)
from chronos import Chronos2Pipeline

from src.data_loader import load_data
from src.baselines import evaluate_metrics, moving_average_baseline

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = PROJECT_ROOT / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

CHRONOS_2_ID = "amazon/chronos-2"
MEDIAN_QUANTILE_IDX = 10
LAG_COLS = [
    "util_lag_5",
    "util_lag_4",
    "util_lag_3",
    "util_lag_2",
    "util_lag_1",
    "utilization_pct",
]
BATCH_SIZE = 64


def load_config() -> Dict[str, Any]:
    config_path = PROJECT_ROOT / "config" / "config.yaml"
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


def get_threshold() -> float:
    config = load_config()
    return float(config.get("congestion", {}).get("high_threshold", 50.0))


def run_chronos2_univariate(df_eval: pd.DataFrame) -> Tuple[np.ndarray, float]:
    """Run Chronos-2 univariate inference with torch.inference_mode."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[{CHRONOS_2_ID}] Loading model on {device} ...")
    pipe = Chronos2Pipeline.from_pretrained(
        CHRONOS_2_ID,
        device_map=device,
        dtype=torch.float32,
    )

    inputs = [
        np.array([row[c] for c in LAG_COLS], dtype=np.float32)
        for _, row in df_eval.iterrows()
    ]

    preds = []
    print(f"[{CHRONOS_2_ID}] Running inference ({len(inputs)} samples)...")
    t0 = time.perf_counter()

    with torch.inference_mode():
        for i in range(0, len(inputs), BATCH_SIZE):
            batch = inputs[i : i + BATCH_SIZE]
            forecasts = pipe.predict(
                inputs=batch,
                prediction_length=1,
            )
            for f in forecasts:
                median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
                preds.append(median_val)
            if (i + BATCH_SIZE) % (BATCH_SIZE * 50) == 0:
                print(f"  Processed {min(i + BATCH_SIZE, len(inputs))} / {len(inputs)}")

    elapsed = time.perf_counter() - t0
    preds_arr = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds_arr, elapsed


def calc_classification_metrics(
    y_true: np.ndarray,
    y_pred: np.ndarray,
    threshold: float,
    split_name: str,
    model_name: str,
) -> Tuple[Dict[str, Any], np.ndarray, np.ndarray]:
    """Compute comprehensive classification metrics for binary congestion detection."""
    y_true_cls = (y_true > threshold).astype(int)
    y_pred_cls = (y_pred > threshold).astype(int)

    total = len(y_true)
    actual_pos = int(y_true_cls.sum())
    actual_neg = total - actual_pos
    pred_pos = int(y_pred_cls.sum())
    prevalence = actual_pos / total if total > 0 else 0.0

    print(f"\n--- Congestion Evaluation [{model_name} | {split_name}] ---")
    print(f"Total samples            : {total:,}")
    print(f"Actual congested (pos)   : {actual_pos:,}")
    print(f"Actual non-congested(neg): {actual_neg:,}")
    print(f"Congestion prevalence    : {prevalence:.4%}")
    print(f"Predicted congested      : {pred_pos:,}")

    if actual_pos == 0:
        print("  NOTE: 0 actual congested samples in this subset. Precision/Recall/PR-AUC undefined.")

    tn, fp, fn, tp = confusion_matrix(y_true_cls, y_pred_cls, labels=[0, 1]).ravel()

    accuracy = float(accuracy_score(y_true_cls, y_pred_cls))
    balanced_acc = float(balanced_accuracy_score(y_true_cls, y_pred_cls))
    mcc = float(matthews_corrcoef(y_true_cls, y_pred_cls))

    precision = float(tp / (tp + fp)) if (tp + fp) > 0 else None
    recall = float(tp / (tp + fn)) if (tp + fn) > 0 else None
    specificity = float(tn / (tn + fp)) if (tn + fp) > 0 else None
    f1 = (
        float(2 * (precision * recall) / (precision + recall))
        if (precision is not None and recall is not None and (precision + recall) > 0)
        else None
    )
    pr_auc = (
        float(average_precision_score(y_true_cls, y_pred))
        if actual_pos > 0
        else None
    )

    metrics = {
        "accuracy": accuracy,
        "balanced_accuracy": balanced_acc,
        "precision": precision,
        "recall": recall,
        "specificity": specificity,
        "f1": f1,
        "mcc": mcc,
        "pr_auc": pr_auc,
        "confusion_matrix": {
            "TN": int(tn),
            "FP": int(fp),
            "FN": int(fn),
            "TP": int(tp),
        },
        "actual_congested": actual_pos,
        "predicted_congested": pred_pos,
        "prevalence": prevalence,
    }

    return metrics, y_true_cls, y_pred_cls


def plot_and_save(
    y_true_cls: np.ndarray,
    y_pred_cls: np.ndarray,
    y_pred_scores: np.ndarray,
    model_name: str,
    split_name: str,
):
    """Save confusion matrix and PR-curve plots."""
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"{model_name.replace('/', '_').replace(' ', '_')}_{split_name.replace(' ', '_')}"

    # 1. Confusion Matrix
    cm = confusion_matrix(y_true_cls, y_pred_cls, labels=[0, 1])
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=["LOW", "HIGH"])
    fig, ax = plt.subplots(figsize=(5, 4))
    disp.plot(ax=ax, cmap="Blues")
    ax.set_title(f"Confusion Matrix: {model_name}\n({split_name})")
    plt.tight_layout()
    plt.savefig(FIGURES_DIR / f"cm_{suffix}.png")
    plt.close()

    # 2. Precision-Recall Curve (if positive samples exist)
    if y_true_cls.sum() > 0:
        precisions, recalls, _ = precision_recall_curve(y_true_cls, y_pred_scores)
        pr_auc = average_precision_score(y_true_cls, y_pred_scores)
        plt.figure(figsize=(6, 4))
        plt.plot(recalls, precisions, marker=".", label=f"PR-AUC = {pr_auc:.4f}")
        plt.xlabel("Recall")
        plt.ylabel("Precision")
        plt.title(f"Precision-Recall Curve: {model_name}\n({split_name})")
        plt.legend()
        plt.grid(True)
        plt.tight_layout()
        plt.savefig(FIGURES_DIR / f"pr_{suffix}.png")
        plt.close()


def run_evaluation(
    df: pd.DataFrame,
    split_name: str,
    threshold: float,
    run_chronos: bool = True,
) -> Dict[str, Any]:
    """Run regression and classification evaluation for Moving Average and Chronos-2."""
    y_true = df["target_utilization_pct"].values
    results = {}

    # 1. Moving Average Baseline
    _, y_pred_ma = moving_average_baseline(df)
    y_pred_ma = np.array([min(100.0, max(0.0, p)) for p in y_pred_ma])

    reg_ma = evaluate_metrics(y_true, y_pred_ma)
    cls_ma, y_true_cls, y_pred_cls_ma = calc_classification_metrics(
        y_true, y_pred_ma, threshold, split_name, "Moving Average"
    )
    plot_and_save(y_true_cls, y_pred_cls_ma, y_pred_ma, "Moving Average", split_name)

    results["Moving Average"] = {
        "regression": reg_ma,
        "classification": cls_ma,
        "inference_ms_per_sample": 0.0,
    }

    # 2. Chronos-2
    if run_chronos:
        try:
            preds_c2, elapsed = run_chronos2_univariate(df)
            reg_c2 = evaluate_metrics(y_true, preds_c2)
            cls_c2, _, y_pred_cls_c2 = calc_classification_metrics(
                y_true, preds_c2, threshold, split_name, CHRONOS_2_ID
            )
            plot_and_save(y_true_cls, y_pred_cls_c2, preds_c2, CHRONOS_2_ID, split_name)

            results[CHRONOS_2_ID] = {
                "regression": reg_c2,
                "classification": cls_c2,
                "inference_ms_per_sample": (elapsed / len(y_true)) * 1000,
            }
        except Exception as e:
            print(f"Error executing Chronos-2 on {split_name}: {e}")
            results[CHRONOS_2_ID] = {"error": str(e)}

    return results


def generate_markdown_report(
    all_results: Dict[str, Any],
    threshold: float,
    split_lengths: Dict[str, int],
) -> str:
    """Generate Markdown evaluation report summarizing regression and classification."""
    md = [
        "# Congestion Evaluation Report\n",
        f"**Congestion Threshold**: {threshold}%\n",
        f"**Primary Neural Predictor**: {CHRONOS_2_ID} (univariate, zero-shot)\n",
        "**Baseline / Fallback**: Moving Average (util_mean_3)\n",
        "\n> **Note on Metric Derivation**: The prediction layer forecasts continuous 0-100% link utilization. Congestion labels (LOW / HIGH) are derived purely by applying the configured routing policy threshold (target > 50.0%). The module does *not* predict router packet loss or queue delay directly.\n\n",
    ]

    for split_name, res in all_results.items():
        n_samples = split_lengths.get(split_name, 0)
        md.append(f"## {split_name} Split ({n_samples:,} samples)\n")

        md.append("### 1. Continuous Forecasting Accuracy (Regression)\n")
        md.append("| Model | MAE | RMSE | R² | Bias | Inference (ms/sample) |")
        md.append("|---|---|---|---|---|---|")

        for model_name, metrics in res.items():
            if "error" in metrics:
                md.append(f"| {model_name} | ERROR | ERROR | ERROR | ERROR | ERROR |")
                continue
            reg = metrics["regression"]
            inf = metrics.get("inference_ms_per_sample", 0.0)
            bias = reg.get("Bias", 0.0)
            md.append(
                f"| {model_name} | {reg['MAE']:.4f} | {reg['RMSE']:.4f} | {reg['R2']:.4f} | {bias:+.4f} | {inf:.3f} |"
            )

        md.append("\n### 2. Congestion Detection Accuracy (Classification)\n")
        md.append("| Model | Accuracy | Balanced Acc | F1 | Precision | Recall | Specificity | PR-AUC | MCC |")
        md.append("|---|---|---|---|---|---|---|---|---|")

        for model_name, metrics in res.items():
            if "error" in metrics:
                md.append(f"| {model_name} | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR |")
                continue
            cls_m = metrics["classification"]

            def fmt(v):
                return f"{v:.4f}" if v is not None else "N/A"

            md.append(
                f"| {model_name} | {fmt(cls_m['accuracy'])} | {fmt(cls_m['balanced_accuracy'])} | "
                f"{fmt(cls_m['f1'])} | {fmt(cls_m['precision'])} | {fmt(cls_m['recall'])} | "
                f"{fmt(cls_m['specificity'])} | {fmt(cls_m['pr_auc'])} | {fmt(cls_m['mcc'])} |"
            )

        md.append("\n**Confusion Matrices**:\n")
        for model_name, metrics in res.items():
            if "error" not in metrics:
                cm = metrics["classification"]["confusion_matrix"]
                md.append(f"- **{model_name}**: TN={cm['TN']:,}, FP={cm['FP']:,}, FN={cm['FN']:,}, TP={cm['TP']:,}")
        md.append("\n---\n")

    return "\n".join(md)


def main():
    parser = argparse.ArgumentParser(description="Congestion & Forecasting Evaluator")
    parser.add_argument("--threshold", type=float, default=None, help="Congestion threshold percentage")
    parser.add_argument("--full-val", action="store_true", help="Evaluate on the full validation split (~181k rows)")
    parser.add_argument("--val-samples", type=int, default=2000, help="Validation sample count when --full-val is omitted")
    parser.add_argument("--val-only", action="store_true", help="Evaluate only on the validation split")
    parser.add_argument("--test-only", action="store_true", help="Evaluate only on the test split")
    parser.add_argument("--skip-chronos", action="store_true", help="Evaluate only Moving Average baseline")
    args = parser.parse_args()

    threshold = args.threshold if args.threshold is not None else get_threshold()
    print(f"Loaded high congestion threshold: {threshold}%")

    all_results = {}
    split_lengths = {}

    # Validation Evaluation
    if not args.test_only:
        val_nrows = None if args.full_val else args.val_samples
        print(f"\nLoading validation data ({'full split' if args.full_val else f'n={val_nrows}'})...")
        val_df = load_data("val", nrows=val_nrows)
        if not args.full_val and len(val_df) > args.val_samples:
            val_df = val_df.iloc[: args.val_samples].copy()

        split_name = "Validation (Full)" if args.full_val else f"Validation (n={len(val_df)})"
        split_lengths[split_name] = len(val_df)

        print("\n" + "=" * 60)
        print(f"Evaluating {split_name}")
        print("=" * 60)
        all_results[split_name] = run_evaluation(
            val_df, split_name, threshold, run_chronos=not args.skip_chronos
        )

    # Test Evaluation
    if not args.val_only:
        print("\nLoading full test dataset...")
        test_df = load_data("test")
        split_name = f"Test (Full, n={len(test_df)})"
        split_lengths[split_name] = len(test_df)

        print("\n" + "=" * 60)
        print(f"Evaluating {split_name}")
        print("=" * 60)
        all_results[split_name] = run_evaluation(
            test_df, split_name, threshold, run_chronos=not args.skip_chronos
        )

    # Save reports
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = REPORTS_DIR / "congestion_evaluation.json"
    md_path = REPORTS_DIR / "congestion_evaluation.md"

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(all_results, f, indent=2)

    md_content = generate_markdown_report(all_results, threshold, split_lengths)
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)

    print("\nEvaluation complete!")
    print(f"JSON Report saved -> {json_path}")
    print(f"Markdown Report saved -> {md_path}")
    print(f"Figures saved -> {FIGURES_DIR}")


if __name__ == "__main__":
    main()
