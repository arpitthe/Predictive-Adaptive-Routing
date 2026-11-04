"""
audit_dataset.py
================
Audits train, validation, and test CSVs for the Abilene ML dataset.

Run from the prediction_layer directory:
    python -m scripts.audit_dataset

Or from any directory by setting DATASET_DIR:
    set DATASET_DIR=C:/path/to/dataset
    python -m scripts.audit_dataset

Unit convention (verified against raw traffic/capacity fields):
    utilization_pct = (traffic_kbps / capacity_kbps) * 100
    This produces values on a 0-100 percentage-point scale.
    Example: traffic=5927 kbps, capacity=9920000 kbps -> 0.0597%
    The stored value 0.0597 represents 0.0597 percentage-points (not 5.97%).
    Values range from ~0% (idle link) to ~75% (peak utilization in test set).
    No multiplication by 100 is needed or correct -- the column is already in %.
"""

import os
import sys
from pathlib import Path

import pandas as pd


# ── Path resolution ────────────────────────────────────────────────────────────
# prediction_layer root = two levels up from this file (scripts/audit_dataset.py)
_PREDICTION_LAYER_ROOT = Path(__file__).resolve().parent.parent

# Dataset directory: override with DATASET_DIR env var, or default to
# sibling "dataset" folder next to the prediction_layer directory.
_DEFAULT_DATASET_DIR = _PREDICTION_LAYER_ROOT.parent / "dataset"
_DATASET_DIR = Path(os.getenv("DATASET_DIR", _DEFAULT_DATASET_DIR))

# Reports directory
_REPORTS_DIR = _PREDICTION_LAYER_ROOT / "reports"


def _dataset_path(name: str) -> Path:
    """
    Return the path to a dataset CSV.
    Kaggle-style layout: dataset/<name>.csv/<name>.csv
    """
    return _DATASET_DIR / f"{name}.csv" / f"{name}.csv"


def audit_dataset():
    report = []

    def log(msg):
        # Use errors='replace' so Unicode characters don't crash on cp1252 terminals
        print(msg.encode("utf-8", errors="replace").decode("utf-8", errors="replace"))
        report.append(msg)

    paths = {
        "train": _dataset_path("abilene_ml_train"),
        "val":   _dataset_path("abilene_ml_val"),
        "test":  _dataset_path("abilene_ml_test"),
    }

    datasets = {}
    time_ranges = {}

    for split, path in paths.items():
        log("==================================================")
        log(f"AUDITING {split.upper()} SET")
        log("==================================================")

        if not path.exists():
            log(f"File not found: {path}")
            log("  -> Set DATASET_DIR environment variable if datasets are elsewhere.")
            continue

        df = pd.read_csv(path)
        datasets[split] = df

        log(f"Shape: {df.shape}")
        log(f"Columns: {list(df.columns)}")
        log(f"\nDtypes:\n{df.dtypes}")

        missing = df.isnull().sum()
        log(f"\nMissing values:\n{missing[missing > 0]}")

        log(f"Duplicate rows: {df.duplicated().sum()}")

        if "link_index" in df.columns:
            log(f"Unique links: {df['link_index'].nunique()}")

        if "src" in df.columns and "dst" in df.columns:
            unique_sd = df.groupby(["src", "dst"]).ngroups
            log(f"Unique src-dst pairs: {unique_sd}")

        if "timestamp" in df.columns:
            df["timestamp"] = pd.to_datetime(df["timestamp"])
            time_min = df["timestamp"].min()
            time_max = df["timestamp"].max()
            time_ranges[split] = (time_min, time_max)
            log(f"Time range: {time_min} to {time_max}")

        if "week_id" in df.columns:
            log(f"Number of weekly partitions: {df['week_id'].nunique()}")

        if "target_utilization_pct" in df.columns:
            log(f"\nTarget utilization stats:\n{df['target_utilization_pct'].describe()}")

        if "utilization_pct" in df.columns:
            log(f"\nUtilization stats:\n{df['utilization_pct'].describe()}")
            neg_util = (df["utilization_pct"] < 0).sum()
            log(f"Suspicious values (negative utilization): {neg_util}")

            # ── Unit verification ─────────────────────────────────────────────
            # utilization_pct is already in percentage-points (0–100 scale).
            # Derivation: utilization_pct = (traffic_kbps / capacity_kbps) * 100
            # A value of 0.0597 means 0.0597% utilization, NOT 5.97%.
            # Do NOT multiply by 100 — that would double-convert.
            # ─────────────────────────────────────────────────────────────────
            sample_vals = df["utilization_pct"].dropna().head(5).tolist()
            log("Sample utilization_pct values (already in percentage-point units, 0-100 scale):")
            for val in sample_vals:
                log(f"  {val:.6f}%")

            # Spot-check: verify calculated vs stored utilization
            if "traffic_kbps" in df.columns and "capacity_kbps" in df.columns:
                mask = df["capacity_kbps"] > 0
                calc = (df.loc[mask, "traffic_kbps"] / df.loc[mask, "capacity_kbps"] * 100)
                stored = df.loc[mask, "utilization_pct"]
                max_diff = (calc - stored).abs().max()
                log(f"\nUnit check -- max |calculated - stored| utilization_pct: {max_diff:.8f}%")
                if max_diff < 0.001:
                    log("  [OK] Stored values match (traffic/capacity)*100. Scale is correct.")
                else:
                    log(f"  [FAIL] Discrepancy detected ({max_diff:.4f}%). Investigate data source.")

        if "target_congestion" in df.columns:
            log(f"\nTarget congestion class distribution:\n"
                f"{df['target_congestion'].value_counts(dropna=False)}")

        log(f"\nNumeric columns Min/Max:")
        numeric_cols = df.select_dtypes(include="number").columns
        for col in numeric_cols:
            log(f"  {col}: Min = {df[col].min()}, Max = {df[col].max()}")

        log("\n")

    # ── Chronological verification ─────────────────────────────────────────────
    log("==================================================")
    log("CHRONOLOGICAL VERIFICATION")
    log("==================================================")

    if len(time_ranges) == 3:
        train_max = time_ranges["train"][1]
        val_min   = time_ranges["val"][0]
        val_max   = time_ranges["val"][1]
        test_min  = time_ranges["test"][0]

        train_before_val = train_max < val_min
        val_before_test  = val_max < test_min

        log(f"Train ends:  {train_max}")
        log(f"Val starts:  {val_min}")
        log(f"Val ends:    {val_max}")
        log(f"Test starts: {test_min}")
        log(f"Train is chronologically before Validation: {train_before_val}")
        log(f"Validation is chronologically before Test:  {val_before_test}")

        if not train_before_val:
            log("  [FAIL] WARNING: Train/Val ordering violation!")
        if not val_before_test:
            log("  [FAIL] WARNING: Val/Test ordering violation!")
    else:
        log("Skipping chronological check: not all splits were loaded.")

    # ── Save report ────────────────────────────────────────────────────────────
    _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    out_path = _REPORTS_DIR / "dataset_audit.txt"
    out_path.write_text("\n".join(report), encoding="utf-8")
    print(f"\nAudit report saved -> {out_path}")


if __name__ == "__main__":
    audit_dataset()
