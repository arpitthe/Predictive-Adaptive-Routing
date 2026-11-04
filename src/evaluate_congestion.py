import os
import json
import time
from pathlib import Path
import yaml
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import torch
from sklearn.metrics import (
    accuracy_score, confusion_matrix, matthews_corrcoef, balanced_accuracy_score,
    average_precision_score, precision_recall_curve, ConfusionMatrixDisplay
)
from chronos import Chronos2Pipeline

from src.data_loader import load_data
from src.baselines import evaluate_metrics, moving_average_baseline

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = PROJECT_ROOT / "reports"
FIGURES_DIR = REPORTS_DIR / "figures"

CHRONOS_2_ID = "amazon/chronos-2"
MEDIAN_QUANTILE_IDX = 10
LAG_COLS = ["util_lag_5", "util_lag_4", "util_lag_3", "util_lag_2", "util_lag_1", "utilization_pct"]
BATCH_SIZE = 64

def load_config():
    config_path = PROJECT_ROOT / "config" / "config.yaml"
    if config_path.exists():
        with open(config_path, "r") as f:
            return yaml.safe_load(f)
    return {}

def get_threshold():
    config = load_config()
    return config.get("congestion", {}).get("high_threshold", 50.0)

def run_chronos2_univariate(df_eval: pd.DataFrame):
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
    
    forecasts = pipe.predict(
        inputs=inputs,
        prediction_length=1,
        batch_size=BATCH_SIZE,
    )
    for f in forecasts:
        median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
        preds.append(median_val)
        
    elapsed = time.perf_counter() - t0
    # Clamping safely
    preds = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds, elapsed

def calc_classification_metrics(y_true, y_pred, threshold, split_name, model_name):
    y_true_cls = (y_true > threshold).astype(int)
    y_pred_cls = (y_pred > threshold).astype(int)
    
    total = len(y_true)
    actual_pos = int(y_true_cls.sum())
    actual_neg = total - actual_pos
    pred_pos = int(y_pred_cls.sum())
    prevalence = actual_pos / total if total > 0 else 0
    
    print(f"\n--- Class Imbalance Report [{model_name} | {split_name}] ---")
    print(f"Total samples            : {total}")
    print(f"Actual congested (pos)   : {actual_pos}")
    print(f"Actual non-congested(neg): {actual_neg}")
    print(f"Congestion prevalence    : {prevalence:.4%}")
    print(f"Predicted congested      : {pred_pos}")
    
    if actual_pos == 0:
        print("WARNING: Actual congested samples is 0. Precision, Recall, F1, PR-AUC will be unreliable or undefined.")
        
    tn, fp, fn, tp = confusion_matrix(y_true_cls, y_pred_cls, labels=[0, 1]).ravel()
    
    accuracy = accuracy_score(y_true_cls, y_pred_cls)
    balanced_acc = balanced_accuracy_score(y_true_cls, y_pred_cls)
    mcc = matthews_corrcoef(y_true_cls, y_pred_cls)
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tp / (tp + fn) if (tp + fn) > 0 else None
    specificity = tn / (tn + fp) if (tn + fp) > 0 else None
    f1 = 2 * (precision * recall) / (precision + recall) if (precision is not None and recall is not None and (precision + recall) > 0) else None
    pr_auc = average_precision_score(y_true_cls, y_pred) if actual_pos > 0 else None
        
    return {
        "accuracy": float(accuracy),
        "balanced_accuracy": float(balanced_acc),
        "precision": float(precision) if precision is not None else None,
        "recall": float(recall) if recall is not None else None,
        "specificity": float(specificity) if specificity is not None else None,
        "f1": float(f1) if f1 is not None else None,
        "mcc": float(mcc),
        "pr_auc": float(pr_auc) if pr_auc is not None else None,
        "confusion_matrix": {
            "TN": int(tn), "FP": int(fp), "FN": int(fn), "TP": int(tp)
        }
    }, y_true_cls, y_pred_cls

def plot_and_save(y_true_cls, y_pred_cls, y_pred_scores, model_name, split_name):
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"{model_name.replace('/', '_').replace(' ', '_')}_{split_name.replace(' ', '_').replace('=', '')}"
    
    # Confusion Matrix
    cm = confusion_matrix(y_true_cls, y_pred_cls, labels=[0, 1])
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=["LOW", "HIGH"])
    fig, ax = plt.subplots()
    disp.plot(ax=ax, cmap="Blues")
    ax.set_title(f"Confusion Matrix: {model_name}\n({split_name})")
    plt.tight_layout()
    plt.savefig(FIGURES_DIR / f"cm_{suffix}.png")
    plt.close()
    
    # PR Curve
    if y_true_cls.sum() > 0:
        precisions, recalls, _ = precision_recall_curve(y_true_cls, y_pred_scores)
        pr_auc = average_precision_score(y_true_cls, y_pred_scores)
        plt.figure()
        plt.plot(recalls, precisions, marker='.', label=f"PR-AUC = {pr_auc:.4f}")
        plt.xlabel("Recall")
        plt.ylabel("Precision")
        plt.title(f"Precision-Recall Curve: {model_name}\n({split_name})")
        plt.legend()
        plt.tight_layout()
        plt.savefig(FIGURES_DIR / f"pr_{suffix}.png")
        plt.close()

def run_evaluation(df, split_name, threshold, run_chronos=True):
    y_true = df["target_utilization_pct"].values
    results = {}
    
    # Moving Average Baseline
    _, y_pred_ma = moving_average_baseline(df)
    y_pred_ma = np.array([min(100.0, max(0.0, p)) for p in y_pred_ma.values])
    
    reg_ma = evaluate_metrics(y_true, y_pred_ma)
    cls_ma, y_true_cls, y_pred_cls_ma = calc_classification_metrics(y_true, y_pred_ma, threshold, split_name, "Moving Average")
    plot_and_save(y_true_cls, y_pred_cls_ma, y_pred_ma, "Moving Average", split_name)
    
    results["Moving Average"] = {
        "regression": reg_ma,
        "classification": cls_ma,
        "inference_ms_per_sample": 0.0
    }
    
    # Chronos-2
    if run_chronos:
        try:
            preds_c2, elapsed = run_chronos2_univariate(df)
            reg_c2 = evaluate_metrics(y_true, preds_c2)
            cls_c2, _, y_pred_cls_c2 = calc_classification_metrics(y_true, preds_c2, threshold, split_name, CHRONOS_2_ID)
            plot_and_save(y_true_cls, y_pred_cls_c2, preds_c2, CHRONOS_2_ID, split_name)
            
            results[CHRONOS_2_ID] = {
                "regression": reg_c2,
                "classification": cls_c2,
                "inference_ms_per_sample": (elapsed / len(y_true)) * 1000
            }
        except Exception as e:
            print(f"Error running Chronos-2 on {split_name}: {e}")
            results[CHRONOS_2_ID] = {"error": str(e)}
            
    return results

def generate_markdown_report(all_results, threshold, val_len, test_len):
    md = [
        "# Congestion Evaluation Report\n",
        f"**Threshold (Configured)**: {threshold}%\n",
        f"**Validation Set (Chronological Subset)**: {val_len} samples\n",
        f"**Test Set (Full Split)**: {test_len} samples\n",
        "**Primary Predictor**: amazon/chronos-2 (univariate, zero-shot)\n",
        "**Baseline**: Moving Average\n",
        "\n> **Note on Objective**: This model predicts near-future link utilization on a continuous 0-100 scale. Congestion labels are derived purely by applying the configurable routing policy threshold. The model does *not* predict latency, packet loss, or queue lengths.\n\n"
    ]
    
    for split_name in ["Validation", "Test"]:
        md.append(f"## {split_name}\n")
        if split_name not in all_results:
            continue
            
        res = all_results[split_name]
        md.append("### 1. Forecasting Accuracy (Regression)\n")
        md.append("| Model | MAE | RMSE | R² | Inference (ms/sample) |")
        md.append("|---|---|---|---|---|")
        
        for model_name, metrics in res.items():
            if "error" in metrics:
                md.append(f"| {model_name} | ERROR | ERROR | ERROR | ERROR |")
                continue
            reg = metrics["regression"]
            inf = metrics.get("inference_ms_per_sample", 0.0)
            md.append(f"| {model_name} | {reg['MAE']:.4f} | {reg['RMSE']:.4f} | {reg['R2']:.4f} | {inf:.3f} |")
            
        md.append("\n### 2. Congestion Detection (Classification)\n")
        md.append("| Model | Accuracy | F1 Score | Precision | Recall | Specificity | PR-AUC | MCC |")
        md.append("|---|---|---|---|---|---|---|---|")
        
        for model_name, metrics in res.items():
            if "error" in metrics:
                md.append(f"| {model_name} | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR | ERROR |")
                continue
            cls = metrics["classification"]
            
            def fmt(v): return f"{v:.4f}" if v is not None else "N/A"
            
            md.append(
                f"| {model_name} | {fmt(cls['accuracy'])} | {fmt(cls['f1'])} | "
                f"{fmt(cls['precision'])} | {fmt(cls['recall'])} | {fmt(cls['specificity'])} | "
                f"{fmt(cls['pr_auc'])} | {fmt(cls['mcc'])} |"
            )
            
        md.append("\n**Confusion Matrices**:\n")
        for model_name, metrics in res.items():
            if "error" not in metrics:
                cm = metrics["classification"]["confusion_matrix"]
                md.append(f"- **{model_name}**: TN={cm['TN']}, FP={cm['FP']}, FN={cm['FN']}, TP={cm['TP']}")
        md.append("\n---\n")
        
    return "\n".join(md)

def main():
    threshold = get_threshold()
    print(f"Loaded high congestion threshold: {threshold}%")
    
    print("Loading datasets...")
    val_df = load_data("val").iloc[:2000].copy()
    test_df = load_data("test")
    
    all_results = {}
    
    print("\n" + "="*50)
    print("Evaluating on Validation Subset (n=2000)")
    print("="*50)
    all_results["Validation"] = run_evaluation(val_df, "Validation", threshold)
    
    print("\n" + "="*50)
    print(f"Evaluating on Full Test Split (n={len(test_df)})")
    print("="*50)
    all_results["Test"] = run_evaluation(test_df, "Test", threshold)
    
    # Save outputs
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = REPORTS_DIR / "congestion_evaluation.json"
    md_path = REPORTS_DIR / "congestion_evaluation.md"
    
    with open(json_path, "w") as f:
        json.dump(all_results, f, indent=2)
        
    md_content = generate_markdown_report(all_results, threshold, len(val_df), len(test_df))
    with open(md_path, "w", encoding="utf-8") as f:
        f.write(md_content)
        
    print(f"\nEvaluation complete!")
    print(f"JSON Report saved to {json_path}")
    print(f"Markdown Report saved to {md_path}")
    print(f"Figures saved to {FIGURES_DIR}")

if __name__ == "__main__":
    main()
