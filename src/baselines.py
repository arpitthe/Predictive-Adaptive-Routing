import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import json

def persistence_baseline(df, target_col='target_utilization_pct', util_col='utilization_pct'):
    """
    Baseline 1: Predicts the next utilization as the current utilization.
    """
    y_true = df[target_col]
    y_pred = df[util_col]
    return y_true, y_pred

def moving_average_baseline(df, target_col='target_utilization_pct', ma_col='util_mean_3'):
    """
    Baseline 2: Predicts using the moving average.
    """
    y_true = df[target_col]
    y_pred = df[ma_col]
    return y_true, y_pred

def evaluate_metrics(y_true, y_pred):
    mae = mean_absolute_error(y_true, y_pred)
    rmse = np.sqrt(mean_squared_error(y_true, y_pred))
    r2 = r2_score(y_true, y_pred)
    
    # MAPE calculation but only where y_true is not exactly zero to avoid infinity
    # Since utilization can be close to 0, MAPE is unstable. We report it carefully.
    mask = y_true != 0
    if mask.sum() > 0:
        mape = np.mean(np.abs((y_true[mask] - y_pred[mask]) / y_true[mask])) * 100
    else:
        mape = np.nan
        
    return {
        "MAE": mae,
        "RMSE": rmse,
        "R2": r2,
        "MAPE": mape
    }

if __name__ == "__main__":
    from src.data_loader import load_data
    val_df = load_data('val')
    
    y_true, y_pred_p = persistence_baseline(val_df)
    metrics_p = evaluate_metrics(y_true, y_pred_p)
    print("Persistence Baseline Metrics (Val):")
    print(json.dumps(metrics_p, indent=2))
    
    y_true, y_pred_ma = moving_average_baseline(val_df)
    metrics_ma = evaluate_metrics(y_true, y_pred_ma)
    print("\nMoving Average Baseline Metrics (Val):")
    print(json.dumps(metrics_ma, indent=2))
