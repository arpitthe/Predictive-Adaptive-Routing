# Congestion Evaluation Report

**Threshold (Configured)**: 50.0%

**Validation Set (Chronological Subset)**: 2000 samples

**Test Set (Full Split)**: 180900 samples

**Primary Predictor**: amazon/chronos-2 (univariate, zero-shot)

**Baseline**: Moving Average


> **Note on Objective**: This model predicts near-future link utilization on a continuous 0-100 scale. Congestion labels are derived purely by applying the configurable routing policy threshold. The model does *not* predict latency, packet loss, or queue lengths.


## Validation

### 1. Forecasting Accuracy (Regression)

| Model | MAE | RMSE | R² | Inference (ms/sample) |
|---|---|---|---|---|
| Moving Average | 0.1772 | 0.3882 | 0.9179 | 0.000 |
| amazon/chronos-2 | 0.1788 | 0.4200 | 0.9039 | 0.777 |

### 2. Congestion Detection (Classification)

| Model | Accuracy | F1 Score | Precision | Recall | Specificity | PR-AUC | MCC |
|---|---|---|---|---|---|---|---|
| Moving Average | 1.0000 | N/A | N/A | N/A | 1.0000 | N/A | 0.0000 |
| amazon/chronos-2 | 1.0000 | N/A | N/A | N/A | 1.0000 | N/A | 0.0000 |

**Confusion Matrices**:

- **Moving Average**: TN=2000, FP=0, FN=0, TP=0
- **amazon/chronos-2**: TN=2000, FP=0, FN=0, TP=0

---

## Test

### 1. Forecasting Accuracy (Regression)

| Model | MAE | RMSE | R² | Inference (ms/sample) |
|---|---|---|---|---|
| Moving Average | 0.2493 | 1.0799 | 0.9630 | 0.000 |
| amazon/chronos-2 | 0.2337 | 1.0118 | 0.9675 | 0.748 |

### 2. Congestion Detection (Classification)

| Model | Accuracy | F1 Score | Precision | Recall | Specificity | PR-AUC | MCC |
|---|---|---|---|---|---|---|---|
| Moving Average | 0.9996 | 0.9696 | 0.9759 | 0.9633 | 0.9999 | 0.9913 | 0.9694 |
| amazon/chronos-2 | 0.9996 | 0.9673 | 0.9586 | 0.9762 | 0.9997 | 0.9575 | 0.9671 |

**Confusion Matrices**:

- **Moving Average**: TN=179783, FP=26, FN=40, TP=1051
- **amazon/chronos-2**: TN=179763, FP=46, FN=26, TP=1065

---
