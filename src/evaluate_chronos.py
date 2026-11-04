"""
evaluate_chronos.py
===================
Zero-shot benchmark for link utilization forecasting on the Abilene dataset.

Models evaluated:
-----------------
1. Persistence baseline
2. Moving-average baseline (util_mean_3)
3. amazon/chronos-t5-tiny (ChronosPipeline, univariate)
4. amazon/chronos-2 (Chronos2Pipeline, univariate)
5. amazon/chronos-2 + past covariates (Chronos2Pipeline, covariate-augmented)

Validation Benchmark:
---------------------
The same chronological validation subset is used for all models (default 2,000 samples).
No fine-tuning is performed on any model.
No future information is passed to any model.

Test Set Evaluation:
--------------------
Evaluates models on the untouched test split (180,900 samples) with strict model
attribution, preventing misattribution bugs.
"""

import argparse
import json
import os
import time
import tracemalloc
from pathlib import Path
from typing import Dict, Tuple

import numpy as np
import pandas as pd
import torch
from chronos import ChronosPipeline, Chronos2Pipeline

from src.data_loader import load_data
from src.baselines import (
    evaluate_metrics,
    persistence_baseline,
    moving_average_baseline,
)

# ── Constants ──────────────────────────────────────────────────────────────────
CHRONOS_TINY_ID = "amazon/chronos-t5-tiny"
CHRONOS_2_ID = "amazon/chronos-2"
MEDIAN_QUANTILE_IDX = 10  # 0.50 quantile among 21 output quantiles

# Context window: 5 lag columns + current utilization (oldest -> newest)
LAG_COLS = [
    "util_lag_5",
    "util_lag_4",
    "util_lag_3",
    "util_lag_2",
    "util_lag_1",
    "utilization_pct",
]

# Past-covariate columns for Chronos-2
PAST_COV_COLS = [
    "traffic_kbps",
    "capacity_kbps",
    "util_mean_3",
    "util_std_3",
    "util_trend_3",
]

TARGET_COL = "target_utilization_pct"
DEFAULT_N_EVAL = 2000
BATCH_SIZE = 64

PROJECT_ROOT = Path(__file__).resolve().parent.parent
REPORTS_DIR = PROJECT_ROOT / "reports"


def measure_memory_mb() -> float:
    """Return peak memory allocated since last reset (MB)."""
    _, peak = tracemalloc.get_traced_memory()
    return peak / (1024 * 1024)


def run_tiny(df_eval: pd.DataFrame) -> Tuple[np.ndarray, float, float]:
    """Run amazon/chronos-t5-tiny (univariate, ChronosPipeline)."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[{CHRONOS_TINY_ID}] Loading model on {device} ...")

    tracemalloc.start()
    pipe = ChronosPipeline.from_pretrained(
        CHRONOS_TINY_ID,
        device_map=device,
        dtype=torch.bfloat16 if device == "cuda" else torch.float32,
    )
    peak_load_mb = measure_memory_mb()
    tracemalloc.stop()

    contexts = [
        torch.tensor([row[c] for c in LAG_COLS], dtype=torch.float32)
        for _, row in df_eval.iterrows()
    ]

    preds = []
    print(f"[{CHRONOS_TINY_ID}] Running inference in batches of {BATCH_SIZE} ...")
    tracemalloc.start()
    t0 = time.perf_counter()

    with torch.inference_mode():
        for i in range(0, len(contexts), BATCH_SIZE):
            batch = contexts[i : i + BATCH_SIZE]
            forecast = pipe.predict(
                inputs=batch,
                prediction_length=1,
                num_samples=20,
            )
            medians = torch.median(forecast[:, :, 0], dim=1).values.cpu().numpy()
            preds.extend(medians.tolist())

    elapsed = time.perf_counter() - t0
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds_arr = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds_arr, elapsed, max(peak_load_mb, peak_infer_mb)


def run_chronos2_univariate(df_eval: pd.DataFrame) -> Tuple[np.ndarray, float, float]:
    """Run amazon/chronos-2 target-only (univariate, no covariates)."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[{CHRONOS_2_ID} univariate] Loading model on {device} ...")

    tracemalloc.start()
    pipe = Chronos2Pipeline.from_pretrained(
        CHRONOS_2_ID,
        device_map=device,
        dtype=torch.float32,
    )
    peak_load_mb = measure_memory_mb()
    tracemalloc.stop()

    inputs = [
        np.array([row[c] for c in LAG_COLS], dtype=np.float32)
        for _, row in df_eval.iterrows()
    ]

    preds = []
    print(f"[{CHRONOS_2_ID} univariate] Running inference ({len(inputs)} samples)...")
    tracemalloc.start()
    t0 = time.perf_counter()

    with torch.inference_mode():
        forecasts = pipe.predict(
            inputs=inputs,
            prediction_length=1,
            batch_size=BATCH_SIZE,
        )
        for f in forecasts:
            median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
            preds.append(median_val)

    elapsed = time.perf_counter() - t0
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds_arr = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds_arr, elapsed, max(peak_load_mb, peak_infer_mb)


def run_chronos2_covariate(df_eval: pd.DataFrame) -> Tuple[np.ndarray, float, float]:
    """Run amazon/chronos-2 with past covariates."""
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"\n[{CHRONOS_2_ID} + covariates] Loading model on {device} ...")

    tracemalloc.start()
    pipe = Chronos2Pipeline.from_pretrained(
        CHRONOS_2_ID,
        device_map=device,
        dtype=torch.float32,
    )
    peak_load_mb = measure_memory_mb()
    tracemalloc.stop()

    inputs = []
    for _, row in df_eval.iterrows():
        target = np.array([row[c] for c in LAG_COLS], dtype=np.float32)
        past_covs = {
            col: np.full(len(target), row[col], dtype=np.float32)
            for col in PAST_COV_COLS
        }
        inputs.append({"target": target, "past_covariates": past_covs})

    preds = []
    print(f"[{CHRONOS_2_ID} + covariates] Running inference ...")
    tracemalloc.start()
    t0 = time.perf_counter()

    with torch.inference_mode():
        forecasts = pipe.predict(
            inputs=inputs,
            prediction_length=1,
            batch_size=BATCH_SIZE,
        )
        for f in forecasts:
            median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
            preds.append(median_val)

    elapsed = time.perf_counter() - t0
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds_arr = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds_arr, elapsed, max(peak_load_mb, peak_infer_mb)


def benchmark_all(n_eval: int = DEFAULT_N_EVAL) -> Dict[str, dict]:
    """Run validation benchmark on chronological subset."""
    print(f"Loading validation data (n={n_eval}) ...")
    val_df = load_data("val", nrows=n_eval)
    df_eval = val_df.iloc[:n_eval].copy()
    y_true = df_eval[TARGET_COL].values

    print(
        f"Evaluation subset: {len(df_eval)} samples | "
        f"time range: {df_eval['timestamp'].min()} to {df_eval['timestamp'].max()}"
    )

    results = {}

    # 1. Persistence
    print("\n[Persistence] Computing ...")
    _, y_pred_p = persistence_baseline(df_eval)
    results["Persistence"] = evaluate_metrics(y_true, y_pred_p)
    results["Persistence"]["inference_ms_per_sample"] = 0.0
    results["Persistence"]["peak_memory_mb"] = 0.0

    # 2. Moving Average
    print("[Moving Average] Computing ...")
    _, y_pred_ma = moving_average_baseline(df_eval)
    results["Moving Average"] = evaluate_metrics(y_true, y_pred_ma)
    results["Moving Average"]["inference_ms_per_sample"] = 0.0
    results["Moving Average"]["peak_memory_mb"] = 0.0

    # 3. chronos-t5-tiny
    try:
        preds_tiny, elapsed_tiny, mem_tiny = run_tiny(df_eval)
        m_tiny = evaluate_metrics(y_true, preds_tiny)
        m_tiny["inference_ms_per_sample"] = (elapsed_tiny / len(y_true)) * 1000
        m_tiny["total_inference_s"] = elapsed_tiny
        m_tiny["peak_memory_mb"] = mem_tiny
        results["chronos-t5-tiny (zero-shot)"] = m_tiny
    except Exception as e:
        results["chronos-t5-tiny (zero-shot)"] = {"error": str(e)}

    # 4. chronos-2 univariate
    try:
        preds_c2u, elapsed_c2u, mem_c2u = run_chronos2_univariate(df_eval)
        m_c2u = evaluate_metrics(y_true, preds_c2u)
        m_c2u["inference_ms_per_sample"] = (elapsed_c2u / len(y_true)) * 1000
        m_c2u["total_inference_s"] = elapsed_c2u
        m_c2u["peak_memory_mb"] = mem_c2u
        results["chronos-2 univariate (zero-shot)"] = m_c2u
    except Exception as e:
        results["chronos-2 univariate (zero-shot)"] = {"error": str(e)}

    # 5. chronos-2 + covariates
    try:
        preds_c2c, elapsed_c2c, mem_c2c = run_chronos2_covariate(df_eval)
        m_c2c = evaluate_metrics(y_true, preds_c2c)
        m_c2c["inference_ms_per_sample"] = (elapsed_c2c / len(y_true)) * 1000
        m_c2c["total_inference_s"] = elapsed_c2c
        m_c2c["peak_memory_mb"] = mem_c2c
        results["chronos-2 + past_covariates (zero-shot)"] = m_c2c
    except Exception as e:
        results["chronos-2 + past_covariates (zero-shot)"] = {"error": str(e)}

    # Print summary table
    print("\n" + "=" * 80)
    print(f"BENCHMARK RESULTS (n={len(df_eval)}, chronological val subset)")
    print("=" * 80)
    print(f"{'Model':<42} {'MAE':>8} {'RMSE':>8} {'R2':>7} {'Bias':>8} {'ms/samp':>9}")
    print("-" * 80)
    for name, m in results.items():
        if "error" in m:
            print(f"{name:<42}  ERROR: {m['error']}")
            continue
        print(
            f"{name:<42} {m['MAE']:>8.4f} {m['RMSE']:>8.4f} {m['R2']:>7.4f} "
            f"{m.get('Bias', 0.0):>8.4f} {m.get('inference_ms_per_sample', 0):>9.3f}"
        )
    print("=" * 80)

    # Save benchmark results
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORTS_DIR / "benchmark_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2)
    print(f"\nValidation benchmark saved -> {out_path}")

    return results


def evaluate_on_test(selected_model_key: str) -> Dict[str, float]:
    """
    Evaluates the specified model on the untouched test split.
    Correctly executes the actual selected model without fall-through errors.
    """
    print(f"\nEvaluating '{selected_model_key}' on FULL TEST SET ...")
    test_df = load_data("test")
    y_true_test = test_df[TARGET_COL].values

    key_lower = selected_model_key.lower()

    if "moving average" in key_lower:
        _, y_pred = moving_average_baseline(test_df)
        preds_test = np.array([min(100.0, max(0.0, p)) for p in y_pred])
    elif "persistence" in key_lower:
        _, y_pred = persistence_baseline(test_df)
        preds_test = np.array([min(100.0, max(0.0, p)) for p in y_pred])
    elif "tiny" in key_lower:
        preds_test, _, _ = run_tiny(test_df)
    elif "covariate" in key_lower:
        preds_test, _, _ = run_chronos2_covariate(test_df)
    elif "chronos-2" in key_lower or "chronos" in key_lower:
        preds_test, _, _ = run_chronos2_univariate(test_df)
    else:
        raise ValueError(f"Unrecognized model key: {selected_model_key}")

    test_metrics = evaluate_metrics(y_true_test, preds_test)

    print(f"\n--- TEST SET METRICS [{selected_model_key}] ---")
    print(json.dumps(test_metrics, indent=2))

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = REPORTS_DIR / "final_test_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "model": selected_model_key,
                "test_metrics": test_metrics,
                "sample_count": len(test_df),
            },
            f,
            indent=2,
        )
    print(f"Test results saved -> {out_path}")
    return test_metrics


def main():
    parser = argparse.ArgumentParser(description="Chronos & Baselines Benchmark")
    parser.add_argument(
        "--n-val",
        type=int,
        default=DEFAULT_N_EVAL,
        help="Number of chronological validation samples (default: 2000)",
    )
    parser.add_argument(
        "--test-model",
        type=str,
        default=None,
        help="Explicitly evaluate a specific model on test set: 'chronos-2' or 'moving_average'",
    )
    args = parser.parse_args()

    results = benchmark_all(n_eval=args.n_val)

    # Determine validation winner honestly
    candidate_keys = [
        "chronos-t5-tiny (zero-shot)",
        "chronos-2 univariate (zero-shot)",
        "chronos-2 + past_covariates (zero-shot)",
        "Persistence",
        "Moving Average",
    ]
    valid_candidates = {
        k: results[k]
        for k in candidate_keys
        if "error" not in results.get(k, {"error": True})
    }

    if valid_candidates:
        best_key = min(valid_candidates, key=lambda k: valid_candidates[k]["MAE"])
        print(
            f"\nLowest validation MAE: {best_key} (MAE={valid_candidates[best_key]['MAE']:.4f})"
        )

        test_target = args.test_model or best_key
        evaluate_on_test(test_target)


if __name__ == "__main__":
    main()
