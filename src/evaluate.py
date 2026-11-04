import os
import json
import joblib
from src.data_loader import load_data
from src.features import NUMERIC_FEATURES, CATEGORICAL_FEATURES, TARGET_COL
from src.baselines import evaluate_metrics

def evaluate_test():
    print("Loading test data...")
    test_df = load_data('test')
    
    X_test = test_df[NUMERIC_FEATURES + CATEGORICAL_FEATURES]
    y_test = test_df[TARGET_COL]
    
    print("Loading final model...")
    from pathlib import Path
    project_root = Path(__file__).resolve().parent.parent
    model_path = project_root / "models" / "final_model.pkl"
    if not model_path.exists():
        raise FileNotFoundError(f"Model not found at {model_path}. Train a model first.")
        
    pipeline = joblib.load(model_path)
    
    print("Evaluating on test set...")
    import time
    t0 = time.time()
    y_pred = pipeline.predict(X_test)
    t_infer = time.time() - t0
    
    metrics = evaluate_metrics(y_test, y_pred)
    metrics['Inference Time (s)'] = t_infer
    metrics['Inference Time per sample (ms)'] = (t_infer / len(y_test)) * 1000
    
    print("\n--- TEST SET METRICS ---")
    print(json.dumps(metrics, indent=2))
    
    reports_dir = project_root / "reports"
    reports_dir.mkdir(exist_ok=True)
    with open(reports_dir / "final_test_results.json", 'w') as f:
        json.dump(metrics, f, indent=2)

if __name__ == "__main__":
    evaluate_test()
