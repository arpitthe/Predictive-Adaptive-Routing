# Manual Verification & Reproduction Plan

**Project**: Predictive AI-Assisted Adaptive Routing — Prediction Layer  
**Target User**: Senior Machine Learning Engineer / Reviewer  
**Purpose**: Exhaustive, prioritized commands for manual verification and benchmarking.

---

## Overview & Execution Safety

As requested, all resource-intensive, long-running, and model-download commands have been deferred for your manual execution. This document provides exact, reproducible steps in order of execution priority.

| Priority | Category | Estimated Duration | Network / GPU Required? |
|---|---|---|---|
| **Tier 1** | Environment & Offline Unit Tests | < 10 seconds | Offline / CPU |
| **Tier 2** | API Service & Mocked Endpoints | < 15 seconds | Offline / CPU |
| **Tier 3** | Real Model Smoke Test | ~30–60 seconds | Hugging Face weights / CPU or GPU |
| **Tier 4** | Dataset Integrity Audit | ~1–2 minutes | Local dataset files / CPU |
| **Tier 5** | Validation Benchmark Reproduction | ~2–5 minutes | Pretrained model / CPU or GPU |
| **Tier 6** | Full Test Set Evaluation | ~15–30 minutes | Pretrained model / GPU recommended |
| **Tier 7** | Legacy Model Verification (Optional) | ~10–20 minutes | Local dataset files / CPU |

---

## Tier 1: Environment & Offline Unit Tests (Instant)

Run these tests immediately to verify syntax, input validation, numeric clamping, routing cost boundaries, and API schemas without downloading weights.

### 1.1 Fast Unit Test Suite
```bash
# Navigate to prediction_layer
cd "c:\Coding\computer network project\prediction_layer"

# Run all offline unit tests
python -m pytest tests/test_routing_cost.py tests/test_predictor_mocked.py tests/test_api_mocked.py -v
```
- **What it tests**:
  - `test_routing_cost.py`: Numeric safety, boundary behavior at exactly 50% (cost=6.0, risk=LOW) vs 50.001% (cost=106.0001, risk=HIGH), NaN/Inf rejection, monotonic cost scaling.
  - `test_predictor_mocked.py`: 6-point lag context validation, out-of-bounds rejection (<0% or >100%), variable context length support, true batch prediction order preservation, and per-item error isolation.
  - `test_api_mocked.py`: FastAPI endpoints (`/health`, `/model-info`, `/predict`, `/predict/batch`, `/routing-cost`), 400 Bad Request error handling, and 503 fallback mechanisms.
- **Expected Output**:
  - `=== 35+ passed in < 5.0 seconds ===`
  - 100% test pass rate with zero network calls.

---

## Tier 2: API Service & Endpoint Sanity Check

### 2.1 Start Local API Server
```bash
uvicorn src.api:app --host 127.0.0.1 --port 8000
```
- **What it does**: Starts the FastAPI ASGI server with modern lifespan model initialization.
- **Expected Console Output**:
  ```
  [startup] Predictor loaded successfully: amazon/chronos-2 on cuda (or cpu)
  INFO:     Application startup complete.
  INFO:     Uvicorn running on http://127.0.0.1:8000
  ```
  *(Note: If running without internet or weights, it prints `[startup] WARNING: Predictor failed to load` and enters fallback mode).*

### 2.2 Health Check Endpoint
```bash
curl -X GET http://127.0.0.1:8000/health
```
- **Expected Output**:
  ```json
  {"status": "healthy", "model": "amazon/chronos-2", "device": "cuda"}
  ```

### 2.3 Single Prediction Endpoint
```bash
curl -X POST http://127.0.0.1:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "link": "ATLA-CHIC",
    "utilization_pct": 28.5,
    "util_lag_1": 27.0,
    "util_lag_2": 26.0,
    "util_lag_3": 25.0,
    "util_lag_4": 24.0,
    "util_lag_5": 23.0
  }'
```
- **Expected Output**:
  - HTTP 200 OK
  - `"predicted_utilization_percent"`: float in `[0, 100]`
  - `"congestion_risk"`: `"LOW"`
  - `"status"`: `"ok"`

### 2.4 Routing Cost Endpoint
```bash
curl -X POST http://127.0.0.1:8000/routing-cost \
  -H "Content-Type: application/json" \
  -d '{
    "predicted_utilization_percent": 65.0,
    "current_metrics": {"link": "ATLA-CHIC"}
  }'
```
- **Expected Output**:
  ```json
  {
    "link": "ATLA-CHIC",
    "predicted_utilization": 0.65,
    "predicted_utilization_percent": 65.0,
    "predicted_cost": 107.5,
    "risk": "HIGH"
  }
  ```

---

## Tier 3: Real Chronos-2 Smoke Test (Single Inference)

Verify that the actual foundation model loads and predicts without runtime errors.

```bash
python -m pytest tests/test_smoke_real_model.py -v -s
```
- **What it tests**:
  - Initializes real `Chronos2Pipeline.from_pretrained("amazon/chronos-2")`.
  - Executes single inference on real Abilene test sample.
  - Executes batch inference on multiple samples.
  - Verifies PyTorch inference mode and output quantiles.
- **Expected Output**:
  - Passes all 8 smoke tests.
  - Console prints:
    `[REAL SMOKE VERIFIED] Link=... | Current=...% | Predicted=...% | Risk=... | Cost=...`
- **Resource Requirements**:
  - ~1.5 GB RAM / VRAM.
  - ~1 minute download time on first run if weights are not cached in `~/.cache/huggingface`.

---

## Tier 4: Dataset Integrity & Unit Audit

```bash
python -m scripts.audit_dataset
```
- **What it tests**:
  - Verifies presence of `abilene_ml_train.csv`, `val.csv`, and `test.csv`.
  - Audits `utilization_pct` unit scale against `(traffic_kbps / capacity_kbps) * 100`.
  - Verifies strictly chronological split order (train < val < test).
  - Checks for negative utilizations, duplicates, and missing values.
- **Expected Output**:
  - `Unit check -- max |calculated - stored| utilization_pct: 0.00000000%`
  - `[OK] Stored values match (traffic/capacity)*100. Scale is correct.`
  - Report saved to `reports/dataset_audit.txt`.

---

## Tier 5: Validation Benchmark Reproduction (n=2,000)

Reproduce the 5-model validation benchmark reported in Section 9 of the README.

```bash
python -m src.evaluate_chronos --n-val 2000
```
- **What it tests**:
  - Evaluates Moving Average, Persistence, Chronos-2 univariate, Chronos-2 + covariates, and chronos-t5-tiny on the same 2,000 chronological validation samples.
  - Measures latency (ms/sample) and memory consumption.
- **Expected Output**:
  ```
  ================================================================================
  BENCHMARK RESULTS (n=2000, chronological val subset)
  ================================================================================
  Model                                           MAE     RMSE      R2     Bias   ms/samp
  --------------------------------------------------------------------------------
  Moving Average                               0.1772   0.3882  0.9179  -0.0001     0.000
  amazon/chronos-2 univariate (zero-shot)      0.1788   0.4200  0.9039  +0.0003     0.830
  amazon/chronos-2 + covariates                0.1805   0.4169  0.9053  +0.0002     3.855
  Persistence                                  0.1804   0.4252  0.9015  -0.0001     0.000
  amazon/chronos-t5-tiny (zero-shot)           0.1820   0.4338  0.8974  +0.0005     0.767
  ================================================================================
  ```
  - Results saved to `reports/benchmark_results.json`.

---

## Tier 6: Full Test Set Evaluation & Congestion Classification

Evaluate regression metrics and congestion classification on the entire 180,900 test set.

```bash
# Full test set evaluation:
python -m src.evaluate_congestion --test-only
```
- **What it tests**:
  - Evaluates continuous regression (MAE, RMSE, R², Bias) and binary classification metrics (Accuracy, Balanced Acc, F1, Precision, Recall, Specificity, PR-AUC, MCC, Confusion Matrix) on all 180,900 test samples.
  - Compares `amazon/chronos-2` vs `Moving Average`.
- **Expected Output**:
  - Test MAE: Chronos-2 ~ `0.2337`, Moving Average ~ `0.2493`.
  - Test Recall: Chronos-2 ~ `97.62%` (26 false negatives), Moving Average ~ `96.33%` (40 false negatives).
  - Reports saved to `reports/congestion_evaluation.json` and `reports/congestion_evaluation.md`.
  - Confusion matrix and PR-curve figures generated in `reports/figures/`.

### 6.1 Full Validation Split Evaluation (Optional)
Evaluate congestion detection across all 180,900 validation samples (instead of the 2,000 idle subset):
```bash
python -m src.evaluate_congestion --val-only --full-val
```

---

## Tier 7: Sample-by-Sample Prediction Inspection Tool

Inspect specific high-congestion cases, false alarms, and missed bottlenecks on the test set.

```bash
# Stratified quick inspection (50 congested and 50 non-congested rows):
python -m src.inspect_predictions --limit 100
```
- **Expected Output**:
  - Prints 10 sample predictions, 10 largest error cases, missed congestion alerts, and false alarms.
  - Outputs `reports/prediction_inspection_test.csv` (ignored by git).
  - Generates scatter plots and error distribution in `reports/figures/`.

---

## Tier 8: Legacy Scikit-Learn Pipeline (Optional Baseline Comparison)

If you wish to retrain or inspect the experimental scikit-learn models (Linear Regression, Random Forest, XGBoost):

```bash
# Train baseline models and save best pipeline to models/final_model.pkl:
python -m src.train

# Evaluate legacy pipeline on test set:
python -m src.evaluate

# Generate error analysis plots:
python -m scripts.generate_reports
```
- **Expected Output**:
  - Saves legacy model metrics to `reports/legacy_sklearn_test_results.json`.
  - Will **not** overwrite `final_test_results.json`.

