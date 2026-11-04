"""
train.py
========
Trains sklearn baseline models (Linear Regression, Random Forest, XGBoost)
on the Abilene ML dataset and saves the best pipeline to models/final_model.pkl.

NOTE: This is the sklearn training script for legacy/experimental comparison models.
The production predictor for the ML Layer is amazon/chronos-2 (zero-shot),
which requires NO training. See src/predictor.py.
"""

import os
import time
import json
from pathlib import Path

import joblib
from sklearn.linear_model import LinearRegression
from sklearn.ensemble import RandomForestRegressor
import xgboost as xgb
from sklearn.pipeline import Pipeline

from src.data_loader import load_data
from src.preprocessing import get_preprocessor
from src.features import NUMERIC_FEATURES, CATEGORICAL_FEATURES, TARGET_COL
from src.baselines import evaluate_metrics

# ── Path resolution ────────────────────────────────────────────────────────────
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_REPORTS_DIR = _PROJECT_ROOT / "reports"
_MODELS_DIR  = _PROJECT_ROOT / "models"


def train_and_evaluate(models_to_run=None):
    if models_to_run is None:
        models_to_run = ["lr", "rf", "xgb"]

    print("Loading data...")
    train_df = load_data("train")
    val_df   = load_data("val")

    X_train = train_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_train = train_df[TARGET_COL]

    X_val = val_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_val = val_df[TARGET_COL]

    results = {}
    best_model_name = None
    best_mae = float("inf")
    best_pipeline = None

    # 1. Linear Regression
    if "lr" in models_to_run:
        print("\nTraining Linear Regression...")
        lr_pipeline = Pipeline([
            ("preprocessor", get_preprocessor("linear")),
            ("model", LinearRegression()),
        ])

        t0 = time.time()
        lr_pipeline.fit(X_train, y_train)
        t_train = time.time() - t0

        t0 = time.time()
        y_pred = lr_pipeline.predict(X_val)
        t_infer = time.time() - t0

        metrics = evaluate_metrics(y_val, y_pred)
        metrics["Train Time (s)"] = t_train
        metrics["Inference Time (s)"] = t_infer
        metrics["Inference Time per sample (ms)"] = (t_infer / len(y_val)) * 1000
        results["Linear Regression"] = metrics

        if metrics["MAE"] < best_mae:
            best_mae = metrics["MAE"]
            best_model_name = "Linear Regression"
            best_pipeline = lr_pipeline

    # 2. Random Forest Regressor
    if "rf" in models_to_run:
        print("\nTraining Random Forest Regressor...")
        rf_pipeline = Pipeline([
            ("preprocessor", get_preprocessor("tree")),
            ("model", RandomForestRegressor(
                n_estimators=50, max_depth=15, n_jobs=-1, random_state=42
            )),
        ])

        t0 = time.time()
        rf_pipeline.fit(X_train, y_train)
        t_train = time.time() - t0

        t0 = time.time()
        y_pred = rf_pipeline.predict(X_val)
        t_infer = time.time() - t0

        metrics = evaluate_metrics(y_val, y_pred)
        metrics["Train Time (s)"] = t_train
        metrics["Inference Time (s)"] = t_infer
        metrics["Inference Time per sample (ms)"] = (t_infer / len(y_val)) * 1000
        results["Random Forest Regressor"] = metrics

        if metrics["MAE"] < best_mae:
            best_mae = metrics["MAE"]
            best_model_name = "Random Forest Regressor"
            best_pipeline = rf_pipeline

    # 3. XGBoost Regressor
    if "xgb" in models_to_run:
        print("\nTraining XGBoost Regressor...")
        xgb_pipeline = Pipeline([
            ("preprocessor", get_preprocessor("tree")),
            ("model", xgb.XGBRegressor(
                n_estimators=100, max_depth=6, learning_rate=0.1,
                n_jobs=-1, random_state=42,
            )),
        ])

        t0 = time.time()
        xgb_pipeline.fit(X_train, y_train)
        t_train = time.time() - t0

        t0 = time.time()
        y_pred = xgb_pipeline.predict(X_val)
        t_infer = time.time() - t0

        metrics = evaluate_metrics(y_val, y_pred)
        metrics["Train Time (s)"] = t_train
        metrics["Inference Time (s)"] = t_infer
        metrics["Inference Time per sample (ms)"] = (t_infer / len(y_val)) * 1000
        results["XGBoost Regressor"] = metrics

        if metrics["MAE"] < best_mae:
            best_mae = metrics["MAE"]
            best_model_name = "XGBoost Regressor"
            best_pipeline = xgb_pipeline

    print("\n--- MODEL COMPARISON ---")
    print(json.dumps(results, indent=2))

    _REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(_REPORTS_DIR / "val_results.json", "w") as f:
        json.dump(results, f, indent=2)

    print(f"\nBest Model: {best_model_name}")
    print("Saving the best model to models/final_model.pkl...")

    _MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = _MODELS_DIR / "final_model.pkl"
    joblib.dump(best_pipeline, model_path)

    with open(_MODELS_DIR / "metadata.json", "w") as f:
        json.dump({
            "model_name": best_model_name,
            "version": "1.0",
            "features": NUMERIC_FEATURES + CATEGORICAL_FEATURES,
            "target": TARGET_COL,
            "metrics": results[best_model_name],
        }, f, indent=2)

    print(f"Model saved → {model_path}")


if __name__ == "__main__":
    train_and_evaluate()
