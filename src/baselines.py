"""
baselines.py
============
Baseline predictors and standard regression metric evaluation for the
Prediction & ML Layer.

Baselines:
----------
1. Persistence: predicts y_{t+1} = y_t (current utilization).
2. Moving Average: predicts y_{t+1} = util_mean_3 (rolling 3-step mean).
"""

import json
from typing import Dict, Tuple, Union
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score


def persistence_baseline(
    df: pd.DataFrame,
    target_col: str = "target_utilization_pct",
    util_col: str = "utilization_pct",
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Baseline 1: Persistence.
    Predicts next utilization as the current utilization.
    """
    y_true = df[target_col].values
    y_pred = df[util_col].values
    return y_true, y_pred


def moving_average_baseline(
    df: pd.DataFrame,
    target_col: str = "target_utilization_pct",
    ma_col: str = "util_mean_3",
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Baseline 2: Moving Average.
    Predicts next utilization as the 3-step moving average.
    """
    y_true = df[target_col].values
    y_pred = df[ma_col].values
    return y_true, y_pred


def evaluate_metrics(
    y_true: Union[np.ndarray, pd.Series],
    y_pred: Union[np.ndarray, pd.Series],
) -> Dict[str, float]:
    """
    Computes standard regression metrics:
    - MAE: Mean Absolute Error
    - RMSE: Root Mean Squared Error
    - R2: Coefficient of Determination
    - MAPE: Mean Absolute Percentage Error (excluding true zero points)
    - Bias: Mean Prediction Bias (pred - true)
    """
    y_t = np.asarray(y_true, dtype=np.float64)
    y_p = np.asarray(y_pred, dtype=np.float64)

    mae = float(mean_absolute_error(y_t, y_p))
    rmse = float(np.sqrt(mean_squared_error(y_t, y_p)))
    r2 = float(r2_score(y_t, y_p))
    bias = float(np.mean(y_p - y_t))

    # MAPE calculation: exclude zero actual values to avoid division by zero
    mask = y_t > 1e-6
    if mask.sum() > 0:
        mape = float(np.mean(np.abs((y_t[mask] - y_p[mask]) / y_t[mask])) * 100.0)
    else:
        mape = float("nan")

    return {
        "MAE": mae,
        "RMSE": rmse,
        "R2": r2,
        "MAPE": mape,
        "Bias": bias,
    }


if __name__ == "__main__":
    from src.data_loader import load_data

    val_df = load_data("val", nrows=2000)

    y_true, y_pred_p = persistence_baseline(val_df)
    metrics_p = evaluate_metrics(y_true, y_pred_p)
    print("Persistence Baseline Metrics (Val, n=2000):")
    print(json.dumps(metrics_p, indent=2))

    y_true, y_pred_ma = moving_average_baseline(val_df)
    metrics_ma = evaluate_metrics(y_true, y_pred_ma)
    print("\nMoving Average Baseline Metrics (Val, n=2000):")
    print(json.dumps(metrics_ma, indent=2))
