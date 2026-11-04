import argparse
import os
import time
import json
from pathlib import Path
import yaml
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import torch
from sklearn.metrics import (
    mean_absolute_error, mean_squared_error, r2_score,
    accuracy_score, precision_score, recall_score, f1_score,
    confusion_matrix, matthews_corrcoef, balanced_accuracy_score,
    average_precision_score, precision_recall_curve, ConfusionMatrixDisplay
)
from chronos import Chronos2Pipeline

from src.data_loader import load_data

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

def run_inference(df_eval: pd.DataFrame):
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
    
    # Run in batches with inference_mode to avoid autograd memory overhead
    with torch.inference_mode():
        for i in range(0, len(inputs), BATCH_SIZE):
            batch = inputs[i:i + BATCH_SIZE]
            forecasts = pipe.predict(
                inputs=batch,
                prediction_length=1,
            )
            for f in forecasts:
                median_val = float(f[0, MEDIAN_QUANTILE_IDX, 0].item())
                preds.append(median_val)
                
            if (i + BATCH_SIZE) % (BATCH_SIZE * 50) == 0:
                print(f"  Processed {min(i+BATCH_SIZE, len(inputs))} / {len(inputs)}")
        
    elapsed = time.perf_counter() - t0
    # Clamping safely
    preds = np.array([min(100.0, max(0.0, p)) for p in preds])
    return preds, elapsed

def calc_metrics(y_true, y_pred, threshold):
    y_true_cls = (y_true > threshold).astype(int)
    y_pred_cls = (y_pred > threshold).astype(int)
    
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    r2 = r2_score(y_true, y_pred)
    bias = np.mean(y_pred - y_true)
    
    tn, fp, fn, tp = confusion_matrix(y_true_cls, y_pred_cls, labels=[0, 1]).ravel()
    
    accuracy = accuracy_score(y_true_cls, y_pred_cls)
    balanced_acc = balanced_accuracy_score(y_true_cls, y_pred_cls)
    mcc = matthews_corrcoef(y_true_cls, y_pred_cls)
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else None
    recall = tp / (tp + fn) if (tp + fn) > 0 else None
    specificity = tn / (tn + fp) if (tn + fp) > 0 else None
    f1 = 2 * (precision * recall) / (precision + recall) if (precision is not None and recall is not None and (precision + recall) > 0) else None
    
    actual_pos = int(y_true_cls.sum())
    pr_auc = average_precision_score(y_true_cls, y_pred) if actual_pos > 0 else None
        
    return {
        "MAE": float(mae),
        "RMSE": float(rmse),
        "R2": float(r2),
        "Bias": float(bias),
        "Accuracy": float(accuracy),
        "Balanced_Accuracy": float(balanced_acc),
        "Precision": float(precision) if precision is not None else None,
        "Recall": float(recall) if recall is not None else None,
        "Specificity": float(specificity) if specificity is not None else None,
        "F1": float(f1) if f1 is not None else None,
        "MCC": float(mcc),
        "PR_AUC": float(pr_auc) if pr_auc is not None else None,
        "TN": int(tn), "FP": int(fp), "FN": int(fn), "TP": int(tp),
        "Actual_Congested": actual_pos,
        "Predicted_Congested": int(y_pred_cls.sum()),
        "Total": len(y_true),
        "Prevalence": actual_pos / len(y_true) if len(y_true) > 0 else 0
    }

def generate_plots(df, threshold):
    FIGURES_DIR.mkdir(parents=True, exist_ok=True)
    
    y_true = df["actual_next_utilization_pct"].values
    y_pred = df["chronos2_predicted_utilization_pct"].values
    
    # 1. Actual vs Predicted
    plt.figure(figsize=(8,8))
    plt.scatter(y_true, y_pred, alpha=0.3, marker='.')
    plt.plot([0, 100], [0, 100], 'r--', label='Ideal')
    plt.xlabel('Actual Utilization (%)')
    plt.ylabel('Predicted Utilization (%)')
    plt.title('Actual vs Predicted Utilization')
    plt.xlim(0, 100)
    plt.ylim(0, 100)
    plt.grid(True)
    plt.legend()
    plt.savefig(FIGURES_DIR / "prediction_actual_vs_predicted.png")
    plt.close()
    
    # 2. Time series for a single link (most active one)
    if 'src' in df.columns:
        active_link = df.groupby('src')['actual_next_utilization_pct'].mean().idxmax()
        df_link = df[df['src'] == active_link].copy()
    else:
        active_link = "Unknown"
        df_link = df.copy()
        
    if len(df_link) > 200:
        df_link = df_link.iloc[-200:]
    
    plt.figure(figsize=(12, 5))
    plt.plot(range(len(df_link)), df_link['actual_next_utilization_pct'], label='Actual', marker='.')
    plt.plot(range(len(df_link)), df_link['chronos2_predicted_utilization_pct'], label='Predicted', marker='.')
    plt.axhline(threshold, color='red', linestyle='--', label='Threshold')
    plt.title(f'Time Series Forecast (Sample from {active_link})')
    plt.xlabel('Time Step')
    plt.ylabel('Utilization (%)')
    plt.legend()
    plt.grid(True)
    plt.savefig(FIGURES_DIR / "prediction_timeseries.png")
    plt.close()
    
    # 3. Error distribution
    plt.figure(figsize=(10, 5))
    plt.hist(df['signed_error'], bins=50, edgecolor='black')
    plt.title('Prediction Error Distribution (Predicted - Actual)')
    plt.xlabel('Error (%)')
    plt.ylabel('Frequency')
    plt.grid(True)
    plt.savefig(FIGURES_DIR / "prediction_error_distribution.png")
    plt.close()
    
    # 4. High utilization slice
    high_util = df[df['actual_next_utilization_pct'] > threshold/2]
    if len(high_util) > 0:
        plt.figure(figsize=(8,8))
        plt.scatter(high_util['actual_next_utilization_pct'], high_util['chronos2_predicted_utilization_pct'], alpha=0.5)
        plt.plot([threshold/2, 100], [threshold/2, 100], 'r--')
        plt.axhline(threshold, color='red', linestyle=':', label='Threshold')
        plt.axvline(threshold, color='red', linestyle=':')
        plt.title('Predictions for High Utilization Samples')
        plt.xlabel('Actual (%)')
        plt.ylabel('Predicted (%)')
        plt.legend()
        plt.grid(True)
        plt.savefig(FIGURES_DIR / "prediction_high_utilization.png")
        plt.close()

def print_examples(title, rows):
    print(f"\n=== {title} ===")
    if len(rows) == 0:
        print("(None found)")
        return
    for _, r in rows.iterrows():
        link = f"{r.get('src', '?')}-{r.get('dst', '?')}"
        print(f"Link: {link:10} | Time: {r.get('timestamp', '?')} | Current: {r['current_utilization_pct']:5.2f}% | "
              f"Actual: {r['actual_next_utilization_pct']:5.2f}% | Pred: {r['chronos2_predicted_utilization_pct']:5.2f}% | "
              f"Err: {r['signed_error']:+5.2f}% | ActCong: {r['actual_congested']} | PredCong: {r['predicted_congested']}")

def main():
    parser = argparse.ArgumentParser(description="Prediction Inspection Tool")
    parser.add_argument("--limit", type=int, help="Limit to N samples (stratified quick inspection)")
    parser.add_argument("--full-test", action="store_true", help="Evaluate the full test set")
    args = parser.parse_args()
    
    if not args.full_test and not args.limit:
        print("Please specify --limit N or --full-test")
        return
        
    threshold = get_threshold()
    print(f"Loaded high congestion threshold: {threshold}%")
    
    print("Loading test dataset...")
    df = load_data("test")
    
    is_stratified = False
    if args.limit and not args.full_test:
        print(f"Sampling {args.limit} rows for quick inspection...")
        high_df = df[df["target_utilization_pct"] > threshold]
        low_df = df[df["target_utilization_pct"] <= threshold]
        
        n_high = min(args.limit // 2, len(high_df))
        n_low = args.limit - n_high
        
        sampled_high = high_df.sample(n=n_high, random_state=42)
        sampled_low = low_df.sample(n=n_low, random_state=42)
        
        df = pd.concat([sampled_high, sampled_low]).sort_index()
        is_stratified = True
        print(f"NOTE: This is a stratified sample for inspection, not a representative metric estimate. "
              f"Sampled {n_high} congested and {n_low} non-congested rows.")
              
    y_true = df["target_utilization_pct"].values
    
    # 1. Moving Average Baseline
    y_pred_ma = df["util_mean_3"].values
    y_pred_ma = np.array([min(100.0, max(0.0, p)) for p in y_pred_ma])
    metrics_ma = calc_metrics(y_true, y_pred_ma, threshold)
    
    # 2. Chronos-2
    preds_c2, elapsed = run_inference(df)
    metrics_c2 = calc_metrics(y_true, preds_c2, threshold)
    
    # 3. Create Row-Level CSV
    out_df = pd.DataFrame({
        "timestamp": df.get("timestamp", ""),
        "week_id": df.get("week_id", 0),
        "link_index": df.get("link_index", 0),
        "src": df.get("src", ""),
        "dst": df.get("dst", ""),
        "current_utilization_pct": df["utilization_pct"],
        "util_lag_5": df["util_lag_5"],
        "util_lag_4": df["util_lag_4"],
        "util_lag_3": df["util_lag_3"],
        "util_lag_2": df["util_lag_2"],
        "util_lag_1": df["util_lag_1"],
        "actual_next_utilization_pct": df["target_utilization_pct"],
        "chronos2_predicted_utilization_pct": preds_c2,
        "signed_error": preds_c2 - df["target_utilization_pct"].values,
        "absolute_error": np.abs(preds_c2 - df["target_utilization_pct"].values),
        "actual_congested": (df["target_utilization_pct"].values > threshold).astype(int),
        "predicted_congested": (preds_c2 > threshold).astype(int),
        "prediction_horizon_minutes": 5
    })
    
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    csv_path = REPORTS_DIR / "prediction_inspection_test.csv"
    out_df.to_csv(csv_path, index=False)
    print(f"\nRow-level predictions saved to {csv_path}")
    
    # 4. Generate Summary Markdown
    md_path = REPORTS_DIR / "prediction_inspection_summary.md"
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("# Prediction Inspection Summary\n\n")
        f.write(f"**Split**: Test Set\n")
        f.write(f"**Samples**: {len(df)} \n")
        if is_stratified:
            f.write("> **WARNING: This is a stratified inspection subset, not a representative metric estimate.**\n\n")
        f.write(f"**Threshold**: {threshold}%\n")
        f.write(f"**Inference Latency**: {elapsed:.2f}s total ({(elapsed/len(df))*1000:.2f} ms/sample)\n\n")
        
        f.write("## Comparison Metrics\n\n")
        f.write("| Metric | Moving Average | amazon/chronos-2 |\n")
        f.write("|---|---|---|\n")
        
        def fmt(m, key): 
            v = m.get(key)
            return f"{v:.4f}" if v is not None else "N/A"
            
        keys = ["MAE", "RMSE", "R2", "Bias", "Accuracy", "Precision", "Recall", "Specificity", 
                "F1", "Balanced_Accuracy", "MCC", "PR_AUC", "Prevalence"]
                
        for k in keys:
            f.write(f"| {k} | {fmt(metrics_ma, k)} | {fmt(metrics_c2, k)} |\n")
            
        f.write(f"| Total Samples | {metrics_ma['Total']} | {metrics_c2['Total']} |\n")
        f.write(f"| Actual Congested | {metrics_ma['Actual_Congested']} | {metrics_c2['Actual_Congested']} |\n")
        f.write(f"| Predicted Congested | {metrics_ma['Predicted_Congested']} | {metrics_c2['Predicted_Congested']} |\n")
        f.write(f"| Confusion Matrix | TN={metrics_ma['TN']} FP={metrics_ma['FP']} FN={metrics_ma['FN']} TP={metrics_ma['TP']} | TN={metrics_c2['TN']} FP={metrics_c2['FP']} FN={metrics_c2['FN']} TP={metrics_c2['TP']} |\n")
        
    print(f"Summary report saved to {md_path}")
    
    # 5. Show Actual Examples
    print_examples("A. Ten randomly selected ordinary samples", 
                   out_df.sample(n=min(10, len(out_df)), random_state=42))
                   
    worst = out_df.sort_values("absolute_error", ascending=False).head(10)
    print_examples("B. Ten samples with largest absolute prediction errors", worst)
    
    missed = out_df[(out_df["actual_congested"] == 1) & (out_df["predicted_congested"] == 0)].head(10)
    print_examples("C. Up to ten missed congestion cases (actual > threshold, predicted <= threshold)", missed)
    
    false_alarms = out_df[(out_df["actual_congested"] == 0) & (out_df["predicted_congested"] == 1)].head(10)
    print_examples("D. Up to ten false congestion alarms (actual <= threshold, predicted > threshold)", false_alarms)

    # 6. Generate Plots
    generate_plots(out_df, threshold)
    print(f"Plots saved to {FIGURES_DIR}")

if __name__ == "__main__":
    main()
