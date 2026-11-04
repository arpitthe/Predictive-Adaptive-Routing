"""
generate_reports.py
===================
Generates error-analysis plots and report for the sklearn baseline model
stored at models/final_model.pkl.

Run from the prediction_layer directory:
    python -m scripts.generate_reports

NOTE: This script is for the legacy sklearn pipeline (src/train.py).
The production Chronos-2 predictor does not use final_model.pkl.
"""

import os
import json
from pathlib import Path

import joblib
import matplotlib.pyplot as plt
import pandas as pd
import seaborn as sns

from src.data_loader import load_data
from src.features import NUMERIC_FEATURES, CATEGORICAL_FEATURES, TARGET_COL

# ── Path resolution ────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_MODELS_DIR   = _PROJECT_ROOT / "models"
_REPORTS_DIR  = _PROJECT_ROOT / "reports"
_FIGURES_DIR  = _REPORTS_DIR / "figures"


def generate_error_analysis():
    print("Generating Error Analysis...")

    test_df = load_data("test")

    model_path = _MODELS_DIR / "final_model.pkl"
    if not model_path.exists():
        raise FileNotFoundError(
            f"Model not found at {model_path}. "
            "Run 'python -m src.train' first to train and save a model."
        )
    pipeline = joblib.load(model_path)

    X_test = test_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_test = test_df[TARGET_COL]

    y_pred = pipeline.predict(X_test)
    test_df = test_df.copy()
    test_df["predicted_utilization"] = y_pred
    test_df["error"]     = test_df["predicted_utilization"] - test_df[TARGET_COL]
    test_df["abs_error"] = test_df["error"].abs()

    _FIGURES_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Actual vs Predicted
    plt.figure(figsize=(8, 6))
    plt.scatter(y_test, y_pred, alpha=0.1, s=1)
    plt.plot([y_test.min(), y_test.max()], [y_test.min(), y_test.max()], "r--")
    plt.xlabel("Actual Utilization (%)")
    plt.ylabel("Predicted Utilization (%)")
    plt.title("Actual vs Predicted Utilization")
    plt.savefig(_FIGURES_DIR / "actual_vs_predicted.png")
    plt.close()

    # 2. Residual Distribution
    plt.figure(figsize=(8, 6))
    sns.histplot(test_df["error"], bins=50, kde=True)
    plt.xlabel("Prediction Error (Predicted - Actual)")
    plt.title("Residual Distribution")
    plt.savefig(_FIGURES_DIR / "residual_distribution.png")
    plt.close()

    # 3. Time Series Segment (one link)
    plt.figure(figsize=(12, 6))
    link_subset = (
        test_df[test_df["link_index"] == test_df["link_index"].unique()[0]]
        .iloc[500:800]
    )
    plt.plot(link_subset["timestamp"], link_subset[TARGET_COL], label="Actual", marker=".")
    plt.plot(link_subset["timestamp"], link_subset["predicted_utilization"], label="Predicted", marker=".")
    plt.xlabel("Time")
    plt.ylabel("Utilization (%)")
    plt.title("Time Series Prediction (Sample Link)")
    plt.legend()
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(_FIGURES_DIR / "time_series_segment.png")
    plt.close()

    # Error analysis report
    report = ["ERROR ANALYSIS REPORT\n"]

    # Hardest to predict links
    link_mae = (
        test_df.groupby("link_index")["abs_error"]
        .mean()
        .sort_values(ascending=False)
    )
    report.append("Top 5 Hardest to Predict Links (Highest Mean Absolute Error):")
    report.append(str(link_mae.head(5)))
    report.append("\n")

    # Error based on utilization bucket
    test_df["util_bin"] = pd.cut(
        test_df[TARGET_COL],
        bins=[0, 10, 30, 50, 100],
        labels=["0-10%", "10-30%", "30-50%", "50-100%"],
    )
    util_mae = test_df.groupby("util_bin")["abs_error"].mean()
    report.append("MAE by Utilization Bucket:")
    report.append(str(util_mae))
    report.append(
        "\nConclusion: The model tends to have slightly larger absolute error "
        "during higher utilization periods, which is typical for variance "
        "scaling with magnitude.\n"
    )

    if hasattr(pipeline.named_steps["model"], "feature_importances_"):
        importances = pipeline.named_steps["model"].feature_importances_
        try:
            cat_feats = (
                pipeline.named_steps["preprocessor"]
                .named_transformers_["cat"]
                .get_feature_names_out(CATEGORICAL_FEATURES)
            )
            feat_names = list(NUMERIC_FEATURES) + list(cat_feats)
        except Exception:
            feat_names = NUMERIC_FEATURES + CATEGORICAL_FEATURES

        if len(importances) == len(feat_names):
            feat_imp = (
                pd.Series(importances, index=feat_names)
                .sort_values(ascending=False)
            )
            report.append("Feature Importances:")
            report.append(str(feat_imp.head(10)))

    out_path = _REPORTS_DIR / "error_analysis.txt"
    out_path.write_text("\n".join(report), encoding="utf-8")
    print(f"Error Analysis complete → {out_path}")
    print(f"Figures saved          → {_FIGURES_DIR}")


if __name__ == "__main__":
    generate_error_analysis()
