"""
evaluate.py
===========
Evaluation script for the legacy/experimental scikit-learn models
(trained via src/train.py and saved to models/final_model.pkl).

NOTE: The production model for the Prediction Layer is amazon/chronos-2
(zero-shot foundation model, evaluated in src/evaluate_chronos.py and
src/evaluate_congestion.py). This script is retained solely for legacy
scikit-learn experimental comparisons.
"""

import json
import time
from pathlib import Path
import joblib

from src.data_loader import load_data
from src.features import NUMERIC_FEATURES, CATEGORICAL_FEATURES, TARGET_COL
from src.baselines import evaluate_metrics


def evaluate_test():
    print("Loading test data...")
    test_df = load_data("test")

    X_test = test_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_test = test_df[TARGET_COL]

    print("Loading legacy sklearn model...")
    project_root = Path(__file__).resolve().parent.parent
    model_path = project_root / "models" / "final_model.pkl"
    if not model_path.exists():
        raise FileNotFoundError(
            f"Legacy model not found at {model_path}. "
            "Run 'python -m src.train' first if you wish to evaluate the sklearn baseline."
        )

    pipeline = joblib.load(model_path)

    print("Evaluating legacy model on test set...")
    t0 = time.time()
    y_pred = pipeline.predict(X_test)
    t_infer = time.time() - t0

    metrics = evaluate_metrics(y_test, y_pred)
    metrics["Inference Time (s)"] = t_infer
    metrics["Inference Time per sample (ms)"] = (t_infer / len(y_test)) * 1000

    print("\n--- LEGACY SKLEARN TEST SET METRICS ---")
    print(json.dumps(metrics, indent=2))

    reports_dir = project_root / "reports"
    reports_dir.mkdir(exist_ok=True)
    out_path = reports_dir / "legacy_sklearn_test_results.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(
            {
                "model_type": "legacy_scikit_learn_pipeline",
                "test_metrics": metrics,
            },
            f,
            indent=2,
        )
    print(f"Legacy sklearn test results saved -> {out_path}")


if __name__ == "__main__":
    evaluate_test()
