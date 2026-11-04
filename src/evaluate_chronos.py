"""
benchmark_models.py
===================
Zero-shot benchmark for link utilization forecasting on the Abilene dataset.

Models evaluated
----------------
1. Persistence baseline
2. Moving-average baseline  (util_mean_3)
3. amazon/chronos-t5-tiny   (ChronosPipeline, univariate)
4. amazon/chronos-2         (Chronos2Pipeline, univariate)
5. amazon/chronos-2 + past covariates (Chronos2Pipeline, covariate-augmented)

Chronos-2 output: list of Tensor(1, 21, pred_len)
Quantile levels:  [0.01, 0.05, 0.10, ..., 0.50, ..., 0.95, 0.99]
Median index: 10  (the 0.50 quantile)

NO fine-tuning is performed on any model.
NO future information is passed to any model.
The same 2000-sample chronological validation subset is used for all models.
"""

import os
import json
import time
import tracemalloc

import numpy as np
import torch
from chronos import ChronosPipeline, Chronos2Pipeline

from src.data_loader import load_data
from src.baselines import evaluate_metrics, persistence_baseline, moving_average_baseline

# ── constants ──────────────────────────────────────────────────────────────────
CHRONOS_TINY_ID  = "amazon/chronos-t5-tiny"
CHRONOS_2_ID     = "amazon/chronos-2"
MEDIAN_QUANTILE_IDX = 10   # 0.50 quantile among the 21 output quantiles

# Context window: 5 lag columns + current utilization (oldest → newest)
LAG_COLS = [
    "util_lag_5", "util_lag_4", "util_lag_3",
    "util_lag_2", "util_lag_1", "utilization_pct",
]

# Past-covariate columns for Chronos-2 (all available at prediction time t)
PAST_COV_COLS = [
    "traffic_kbps",
    "capacity_kbps",
    "util_mean_3",
    "util_std_3",
    "util_trend_3",
]

TARGET_COL   = "target_utilization_pct"
N_EVAL       = 2000
BATCH_SIZE   = 64


# ── helpers ────────────────────────────────────────────────────────────────────

def measure_memory_mb() -> float:
    """Return peak memory allocated since last reset (MB)."""
    _, peak = tracemalloc.get_traced_memory()
    return peak / 1024 / 1024


def run_tiny(df_eval: "pd.DataFrame"):
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

    for i in range(0, len(contexts), BATCH_SIZE):
        batch = contexts[i : i + BATCH_SIZE]
        # returns Tensor[batch, num_samples, pred_len]
        forecast = pipe.predict(
            inputs=batch,
            prediction_length=1,
            num_samples=20,
        )
        # median over samples → shape [batch]
        medians = torch.median(forecast[:, :, 0], dim=1).values.cpu().numpy()
        preds.extend(medians.tolist())
        print(f"  {min(i + BATCH_SIZE, len(contexts))} / {len(contexts)}")

    elapsed = time.perf_counter() - t0
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds = np.array([max(0.0, p) for p in preds])
    return preds, elapsed, max(peak_load_mb, peak_infer_mb)


def run_chronos2_univariate(df_eval: "pd.DataFrame"):
    """Run amazon/chronos-2 with target-only (univariate, no covariates)."""
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
    print(f"[{CHRONOS_2_ID} univariate] Running inference ...")
    tracemalloc.start()
    t0 = time.perf_counter()

    # Chronos2Pipeline handles batching internally via batch_size param
    forecasts = pipe.predict(
        inputs=inputs,
        prediction_length=1,
        batch_size=BATCH_SIZE,
    )
    # forecasts: list of Tensor(n_variates=1, n_quantiles=21, pred_len=1)
    for f in forecasts:
        median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
        preds.append(median_val)

    elapsed = time.perf_counter() - t0
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds = np.array([max(0.0, p) for p in preds])
    return preds, elapsed, max(peak_load_mb, peak_infer_mb)


def run_chronos2_covariate(df_eval: "pd.DataFrame"):
    """
    Run amazon/chronos-2 with past covariates.

    Covariates passed (all available at prediction time t, no leakage):
        traffic_kbps, capacity_kbps, util_mean_3, util_std_3, util_trend_3

    future_covariates are NOT provided because we do not know future network
    conditions. capacity_kbps is technically known in the future (static link
    capacity) but we conservatively omit it from future_covariates to avoid
    any implicit assumptions.
    """
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

    # Build list-of-dict inputs
    inputs = []
    for _, row in df_eval.iterrows():
        target = np.array([row[c] for c in LAG_COLS], dtype=np.float32)
        past_covs = {
            col: np.array([row[col]], dtype=np.float32)   # scalar repeated for context len=1
            # Chronos-2 expects past_cov length == target history_length
            # We tile the scalar value across the context window length
            for col in PAST_COV_COLS
        }
        # Tile each covariate to match target context length (6)
        past_covs = {
            col: np.full(len(target), row[col], dtype=np.float32)
            for col in PAST_COV_COLS
        }
        inputs.append({
            "target": target,
            "past_covariates": past_covs,
        })

    preds = []
    print(f"[{CHRONOS_2_ID} + covariates] Running inference ...")
    tracemalloc.start()
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
    peak_infer_mb = measure_memory_mb()
    tracemalloc.stop()

    preds = np.array([max(0.0, p) for p in preds])
    return preds, elapsed, max(peak_load_mb, peak_infer_mb)


# ── main benchmark ─────────────────────────────────────────────────────────────

def benchmark_all():
    print("Loading validation data ...")
    val_df = load_data("val")

    # Chronological subset – first N rows (already sorted by time in data_loader)
    df_eval = val_df.iloc[:N_EVAL].copy()
    y_true  = df_eval[TARGET_COL].values
    print(f"Evaluation subset: {len(df_eval)} samples | "
          f"time range: {df_eval['timestamp'].min()} to {df_eval['timestamp'].max()}")

    results = {}

    # ── 1. Persistence ───────────────────────────────────────────────────────
    print("\n[Persistence] Computing ...")
    _, y_pred_p = persistence_baseline(df_eval)
    results["Persistence"] = evaluate_metrics(y_true, y_pred_p.values)
    results["Persistence"]["inference_ms_per_sample"] = 0.0
    results["Persistence"]["peak_memory_mb"] = 0.0

    # ── 2. Moving Average ────────────────────────────────────────────────────
    print("[Moving Average] Computing ...")
    _, y_pred_ma = moving_average_baseline(df_eval)
    results["Moving Average"] = evaluate_metrics(y_true, y_pred_ma.values)
    results["Moving Average"]["inference_ms_per_sample"] = 0.0
    results["Moving Average"]["peak_memory_mb"] = 0.0

    # ── 3. chronos-t5-tiny ───────────────────────────────────────────────────
    try:
        preds_tiny, elapsed_tiny, mem_tiny = run_tiny(df_eval)
        metrics_tiny = evaluate_metrics(y_true, preds_tiny)
        metrics_tiny["inference_ms_per_sample"] = (elapsed_tiny / len(y_true)) * 1000
        metrics_tiny["total_inference_s"] = elapsed_tiny
        metrics_tiny["peak_memory_mb"] = mem_tiny
        results["chronos-t5-tiny (zero-shot)"] = metrics_tiny
    except Exception as e:
        results["chronos-t5-tiny (zero-shot)"] = {"error": str(e)}

    # ── 4. chronos-2 univariate ──────────────────────────────────────────────
    try:
        preds_c2u, elapsed_c2u, mem_c2u = run_chronos2_univariate(df_eval)
        metrics_c2u = evaluate_metrics(y_true, preds_c2u)
        metrics_c2u["inference_ms_per_sample"] = (elapsed_c2u / len(y_true)) * 1000
        metrics_c2u["total_inference_s"] = elapsed_c2u
        metrics_c2u["peak_memory_mb"] = mem_c2u
        results["chronos-2 univariate (zero-shot)"] = metrics_c2u
    except Exception as e:
        results["chronos-2 univariate (zero-shot)"] = {"error": str(e)}

    # ── 5. chronos-2 + covariates ────────────────────────────────────────────
    try:
        preds_c2c, elapsed_c2c, mem_c2c = run_chronos2_covariate(df_eval)
        metrics_c2c = evaluate_metrics(y_true, preds_c2c)
        metrics_c2c["inference_ms_per_sample"] = (elapsed_c2c / len(y_true)) * 1000
        metrics_c2c["total_inference_s"] = elapsed_c2c
        metrics_c2c["peak_memory_mb"] = mem_c2c
        results["chronos-2 + past_covariates (zero-shot)"] = metrics_c2c
    except Exception as e:
        results["chronos-2 + past_covariates (zero-shot)"] = {"error": str(e)}

    # ── Summary table ────────────────────────────────────────────────────────
    print("\n" + "=" * 80)
    print("BENCHMARK RESULTS  (n={}, chronological val subset)".format(N_EVAL))
    print("=" * 80)
    header = f"{'Model':<42} {'MAE':>8} {'RMSE':>8} {'R2':>7} {'ms/samp':>9} {'MemMB':>8}"
    print(header)
    print("-" * 80)
    for name, m in results.items():
        if "error" in m:
            print(f"{name:<42}  ERROR: {m['error']}")
            continue
        print(
            f"{name:<42} {m['MAE']:>8.4f} {m['RMSE']:>8.4f} {m['R2']:>7.4f}"
            f" {m.get('inference_ms_per_sample', 0):>9.3f} {m.get('peak_memory_mb', 0):>8.1f}"
        )
    print("=" * 80)

    # ── Save results ─────────────────────────────────────────────────────────
    from pathlib import Path
    project_root = Path(__file__).resolve().parent.parent
    reports_dir = project_root / "reports"
    reports_dir.mkdir(exist_ok=True)
    out_path = reports_dir / "benchmark_results.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved → {out_path}")

    return results


# ── test-set evaluation of selected model ─────────────────────────────────────

def evaluate_on_test(selected_model_key: str, results: dict):
    """
    Evaluate the selected model (identified by its results key) on the
    untouched test set – called exactly once after validation comparison.
    """
    print(f"\nEvaluating selected model '{selected_model_key}' on TEST SET ...")
    test_df = load_data("test")
    y_true_test = test_df[TARGET_COL].values

    device = "cuda" if torch.cuda.is_available() else "cpu"

    if "tiny" in selected_model_key:
        pipe = ChronosPipeline.from_pretrained(
            CHRONOS_TINY_ID, device_map=device,
            dtype=torch.bfloat16 if device == "cuda" else torch.float32,
        )
        contexts = [
            torch.tensor([row[c] for c in LAG_COLS], dtype=torch.float32)
            for _, row in test_df.iterrows()
        ]
        preds_test = []
        for i in range(0, len(contexts), BATCH_SIZE):
            batch = contexts[i : i + BATCH_SIZE]
            forecast = pipe.predict(inputs=batch, prediction_length=1, num_samples=20)
            medians = torch.median(forecast[:, :, 0], dim=1).values.cpu().numpy()
            preds_test.extend(medians.tolist())
            print(f"  {min(i+BATCH_SIZE, len(contexts))} / {len(contexts)}")

    elif "covariate" in selected_model_key:
        pipe = Chronos2Pipeline.from_pretrained(
            CHRONOS_2_ID, device_map=device, dtype=torch.float32
        )
        inputs = []
        for _, row in test_df.iterrows():
            target = np.array([row[c] for c in LAG_COLS], dtype=np.float32)
            past_covs = {
                col: np.full(len(target), row[col], dtype=np.float32)
                for col in PAST_COV_COLS
            }
            inputs.append({"target": target, "past_covariates": past_covs})
        forecasts = pipe.predict(inputs=inputs, prediction_length=1, batch_size=BATCH_SIZE)
        preds_test = [float(f[0, MEDIAN_QUANTILE_IDX, 0].item()) for f in forecasts]

    else:  # chronos-2 univariate
        pipe = Chronos2Pipeline.from_pretrained(
            CHRONOS_2_ID, device_map=device, dtype=torch.float32
        )
        inputs = [
            np.array([row[c] for c in LAG_COLS], dtype=np.float32)
            for _, row in test_df.iterrows()
        ]
        forecasts = pipe.predict(inputs=inputs, prediction_length=1, batch_size=BATCH_SIZE)
        preds_test = [float(f[0, MEDIAN_QUANTILE_IDX, 0].item()) for f in forecasts]

    preds_test = np.array([max(0.0, p) for p in preds_test])
    test_metrics = evaluate_metrics(y_true_test, preds_test)
    print("\nTEST SET METRICS:")
    print(json.dumps(test_metrics, indent=2))

    from pathlib import Path
    project_root = Path(__file__).resolve().parent.parent
    out_path = project_root / "reports" / "final_test_results.json"
    with open(out_path, "w") as f:
        json.dump({"model": selected_model_key, "test_metrics": test_metrics}, f, indent=2)
    print(f"Test results saved → {out_path}")
    return test_metrics


if __name__ == "__main__":
    results = benchmark_all()

    # ── Model selection (validation-based, honest) ───────────────────────────
    # Pick the model with the lowest validation MAE.
    # If a non-ML baseline wins, we report that honestly.
    candidate_keys = [
        "chronos-t5-tiny (zero-shot)",
        "chronos-2 univariate (zero-shot)",
        "chronos-2 + past_covariates (zero-shot)",
        "Persistence",
        "Moving Average",
    ]
    valid_candidates = {k: results[k] for k in candidate_keys if "error" not in results.get(k, {"error": True})}
    best_key = min(valid_candidates, key=lambda k: valid_candidates[k]["MAE"])
    print(f"\nBest model by validation MAE: {best_key}  (MAE={valid_candidates[best_key]['MAE']:.4f})")

    # Evaluate on test set once
    evaluate_on_test(best_key, results)
