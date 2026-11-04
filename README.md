# Predictive AI-Assisted Adaptive Routing — Prediction Layer

**This layer predicts future link utilization. It does not perform route selection.**

## 1. Purpose

This module is the Machine Learning (ML) component of the "Predictive AI-Assisted Adaptive
Routing" project. It monitors a dynamic computer network, predicts near-future link
utilization, and converts those predictions into routing costs that a conventional routing
engine (Dijkstra) can consume.

## 2. Prediction Target

The primary target is `target_utilization_pct`: the link utilization percentage for the
**next 5-minute interval**, on a **0–100 percentage-point scale**.

Example: a stored value of `2.72` means the link is at **2.72% utilization**, not 272%.
The dataset maximum across all splits is approximately **75%** (test set peak).

## 3. Dataset Structure

Derived from the Abilene backbone traffic dataset (5-minute telemetry intervals).

| Split      | Period                                 | Rows     |
|------------|----------------------------------------|----------|
| Train      | 2004-03-01 → 2004-07-30 (18 weeks)    | ~1 085 k |
| Validation | 2004-07-31 → 2004-08-19 (3 weeks)     | ~181 k   |
| Test       | 2004-08-21 → 2004-09-10 (3 weeks)     | ~181 k   |

Splits are **strictly chronological** — no shuffling, no leakage.

Datasets are expected at `../dataset/` relative to this directory (one level up from
`prediction_layer/`), following Kaggle-style layout:

```
dataset/
  abilene_ml_train.csv/abilene_ml_train.csv
  abilene_ml_val.csv/abilene_ml_val.csv
  abilene_ml_test.csv/abilene_ml_test.csv
```

Override with the `DATASET_DIR` environment variable if datasets are elsewhere.

## 4. Utilization Unit Convention

`utilization_pct` is computed as:

```
utilization_pct = (traffic_kbps / capacity_kbps) * 100
```

This is already expressed in **percentage-points (0–100 scale)**. A stored value of
`0.0597` means **0.0597%**, not 5.97%. No further multiplication is needed.

## 5. Features

| Column             | Description |
|--------------------|-------------|
| `capacity_kbps`    | Maximum link capacity (kbps) |
| `traffic_kbps`     | Observed traffic volume (kbps) |
| `utilization_pct`  | Current link utilization % (0–100) |
| `util_lag_1–5`     | Utilization from the preceding 5 time steps (%) |
| `util_mean_3`      | Rolling 3-step mean of utilization (%) |
| `util_std_3`       | Rolling 3-step std dev of utilization (%) |
| `util_trend_3`     | Rolling 3-step trend (slope) of utilization (%) |
| `link_index`       | Categorical link identifier (1–30) |

## 6. Leakage Prevention

- `target_utilization_pct` is used **only** as the training target — never as an input.
- No future information is used at prediction time.
- All preprocessing objects (StandardScaler, OneHotEncoder) are fit **only** on the
  training set and applied identically to validation and test.

## 7. Methodology

- **Primary predictor:** `amazon/chronos-2` — a pretrained zero-shot time-series
  foundation model (`Chronos2Pipeline`). No task-specific fine-tuning is performed.
  Weights are loaded directly from HuggingFace on first use.
- **Fallback:** Moving Average (`util_mean_3`) when Chronos-2 is unavailable.
- **Context window:** 6 points (5 lag columns + current utilization = 30 minutes of history).
- **Evaluation data:** Existing Abilene ML train/val/test splits (original CSVs unchanged).

## 8. Models Evaluated

| Model                                  | Role |
|----------------------------------------|------|
| `amazon/chronos-2` (univariate)        | **Primary pretrained predictor** |
| `amazon/chronos-2` (+ past covariates) | Experimental covariate variant |
| Moving Average (`util_mean_3`)         | **Best validation MAE baseline** |
| Persistence (current = next)           | Simple baseline |
| `amazon/chronos-t5-tiny`               | Additional comparison model |

## 9. Benchmark Results (Validation, n=2000 chronological samples)

All models evaluated on the same 2,000-sample chronological validation subset.
No fine-tuning on any neural model.

| Model                                   | MAE    | RMSE   | R²     | ms/sample |
|-----------------------------------------|--------|--------|--------|-----------|
| **Moving Average** ← best validation MAE | **0.1772** | **0.3882** | **0.9179** | 0.000 |
| chronos-2 univariate (zero-shot)        | 0.1788 | 0.4200 | 0.9039 | 0.830     |
| chronos-2 + past_covariates (zero-shot) | 0.1805 | 0.4169 | 0.9053 | 3.855     |
| Persistence                             | 0.1804 | 0.4252 | 0.9015 | 0.000     |
| chronos-t5-tiny (zero-shot)             | 0.1820 | 0.4338 | 0.8974 | 0.767     |

### Test Set Results (Moving Average, evaluated once)

| Metric | Value  |
|--------|--------|
| MAE    | 0.2337 |
| RMSE   | 1.0119 |
| R²     | 0.9675 |
| MAPE   | 8.89%  |

## 10. Model Selection Rationale

**Overall validation MAE winner: Moving Average.**

**Primary pretrained forecasting model: `amazon/chronos-2`** (architectural choice).

Moving Average achieves the lowest validation MAE with a 6-point context window.
`amazon/chronos-2` is selected as the primary neural predictor because:

- It is the best-performing **zero-shot foundation model** among those tested.
- It will benefit from **longer context windows** as the controller buffers more history
  (Chronos-2 supports up to 8 192 tokens; the current context is only 6 points).
- It provides **21-quantile probabilistic output** (uncertainty-aware).
- The absolute MAE gap versus Moving Average is only 0.0016 (< 1%).

Moving Average is retained as the honest test-set winner and recommended no-dependency
fallback when Chronos-2 weights are unavailable.

## 11. Evaluation Metrics

MAE, RMSE, R² (explained variance), MAPE. MAPE is noted for instability near zero
utilizations (many links have very low utilization in the Abilene dataset).

## 12. How to Benchmark (Chronos-2 vs baselines, validation set)

```bash
# From the prediction_layer directory:
python -m src.evaluate_chronos
```

Results saved to `reports/benchmark_results.json` and printed to stdout.

## 13. How to Evaluate (Moving Average on test set)

```bash
# Moving Average on the test set (legacy sklearn evaluate script):
python -m src.evaluate
```

## 14. How to Run Error Analysis (sklearn model)

```bash
# Requires a trained final_model.pkl (run src/train.py first)
python -m scripts.generate_reports
```

## 15. How to Audit the Dataset

```bash
# From the prediction_layer directory:
python -m scripts.audit_dataset
# Report saved to reports/dataset_audit.txt
```

## 16. How to Run the Demo

```bash
# From the prediction_layer directory:
python -m examples.demo_prediction
```

This loads a real test-set sample, runs Chronos-2 inference, and displays the
routing cost output.

## 17. How to Start the API

```bash
# From the prediction_layer directory:
uvicorn src.api:app --reload --host 0.0.0.0 --port 8000
```

Interactive docs available at: http://localhost:8000/docs

## 18. API Request / Response Examples

### `GET /health`

```json
{"status": "healthy", "model": "amazon/chronos-2"}
```

If the model failed to load:
```json
{"status": "model_missing", "model": "amazon/chronos-2", "error": "..."}
```

### `POST /predict`

**Request** (all utilization values in percentage-points, 0–100 scale):

```json
{
  "link": "R1-R2",
  "link_index": 1,
  "capacity_kbps": 9920000,
  "traffic_kbps": 7200000,
  "utilization_pct": 72.0,
  "util_lag_1": 69.0,
  "util_lag_2": 67.0,
  "util_lag_3": 63.0,
  "util_lag_4": 60.0,
  "util_lag_5": 58.0,
  "util_mean_3": 66.0,
  "util_std_3": 3.0,
  "util_trend_3": 6.0
}
```

**Response:**

```json
{
  "link": "R1-R2",
  "timestamp": "",
  "model": "amazon/chronos-2",
  "prediction_horizon_minutes": 5,
  "current_utilization": 0.72,
  "predicted_utilization": 0.81,
  "predicted_utilization_percent": 81.0,
  "congestion_risk": "HIGH"
}
```

> `predicted_utilization_percent` is the definitive output field (0–100 scale).
> `current_utilization` and `predicted_utilization` are fractional (0–1) for
> downstream compatibility.

### `POST /routing-cost`

**Request:**

```json
{
  "predicted_utilization_percent": 81.0,
  "current_metrics": {"link": "R1-R2"}
}
```

**Response:**

```json
{
  "link": "R1-R2",
  "predicted_utilization": 0.81,
  "predicted_utilization_percent": 81.0,
  "predicted_cost": 109.1,
  "risk": "HIGH"
}
```

### `GET /model-info`

Returns Chronos-2 configuration, benchmark metrics, and congestion threshold.

## 19. Integration Guide (Daksh & Ritu)

```
GNS3 link metrics
    → POST /predict               (Daksh's controller → ML API)
    → predicted_utilization_percent (0–100 %)
    → congestion_risk             (LOW / HIGH, threshold: 50%)
    → POST /routing-cost          (internal or separate call)
    → predicted_cost              (numeric, ≥ 1.0)
    → Dijkstra routing engine     (Ritu's engine consumes predicted_cost)
```

The ML predictor does **not** run Dijkstra or select paths.
The routing-cost module is a **separate configurable policy** layer.

## 20. Running Tests

```bash
# From the prediction_layer directory:
python -m pytest tests/ -v
```
