# Predictive AI-Assisted Adaptive Routing — Prediction & Machine Learning Layer

> **Core Principle**: Machine Learning predicts future link utilization. Traditional routing algorithms (Dijkstra) make routing decisions.

---

## 1. Project Purpose

This repository contains the Machine Learning (ML) & Forecasting subsystem of the **Predictive AI-Assisted Adaptive Routing** project.

Conventional adaptive routing protocols react *after* queues saturate and packets drop. This system operates *proactively*:
1. Observes network link utilization telemetry over time.
2. Predicts near-future link utilization for the **next 5-minute interval**.
3. Translates continuous utilization forecasts into Dijkstra edge costs.
4. Downstream routing engines (Ritu) compute dynamic shortest paths avoiding forecasted bottlenecks before congestion causes packet loss.

---

## 2. System Architecture

```
Telemetric Monitoring (Daksh)
         │  (link telemetry: capacity, traffic, lag history)
         ▼
Prediction Layer (This Module)
   ├── Input Validation & Schema Sanitization (0-100% scale)
   ├── Forecasting Engine: amazon/chronos-2 (univariate zero-shot foundation model)
   │     └── Fallback: Moving Average (util_mean_3)
   └── Routing Cost Engine:
         cost = base_cost (1.0) + (pred_util_pct / 10.0) + (100.0 penalty if > 50%)
         │
         ▼  (Dijkstra edge weights: link -> cost)
Adaptive Routing Engine (Ritu)
   └── Dynamic Shortest Path Calculation & Path Installation
```

### Architectural Non-Goals
The Prediction Layer explicitly does **NOT**:
- Select end-to-end paths or execute Dijkstra.
- Directly configure router forwarding tables or interfaces.
- Collect raw SNMP/packet captures (responsibility of Daksh's controller).

---

## 3. Directory Structure

```
prediction_layer/
├── config/
│   └── config.yaml                 # Centralized configuration (thresholds, model ID, costs)
├── data/
│   └── README.md                   # Dataset directory documentation
├── docs/
│   ├── INTEGRATION_GUIDE.md        # Technical contract for Daksh & Ritu
│   └── VERIFICATION_PLAN.md        # Complete manual verification & reproduction guide
├── examples/
│   └── demo_prediction.py          # Single prediction walkthrough script
├── models/
│   └── .gitkeep                    # Storage for experimental weights (tracked, empty)
├── reports/
│   ├── figures/                    # Generated inspection & PR curve plots
│   ├── benchmark_results.json      # Validation benchmark results (n=2,000)
│   ├── congestion_evaluation.json  # Full validation & test evaluation metrics
│   ├── congestion_evaluation.md    # Summary of classification & regression performance
│   ├── evaluation_discrepancy_audit.md # Investigation of report misattribution
│   └── final_test_results.json     # Historical test results file
├── scripts/
│   ├── audit_dataset.py            # Dataset integrity and unit check script
│   └── generate_reports.py         # Error analysis plots for experimental sklearn models
├── src/
│   ├── __init__.py
│   ├── api.py                      # Production FastAPI backend (single & batch)
│   ├── baselines.py                # Moving Average & Persistence baselines
│   ├── data_loader.py              # Robust CSV data loader (nested & flat support)
│   ├── evaluate.py                 # Evaluator for legacy sklearn pipeline
│   ├── evaluate_chronos.py         # Multi-model benchmark on validation & test splits
│   ├── evaluate_congestion.py      # Regression & classification metric evaluator
│   ├── features.py                 # Feature definitions
│   ├── inspect_predictions.py      # Detailed sample-by-sample inspection tool
│   ├── integration.py              # High-level in-process pipeline for Daksh & Ritu
│   ├── predictor.py                # Production Chronos-2 inference engine
│   ├── preprocessing.py            # Preprocessing transformers (for legacy sklearn)
│   ├── routing_cost.py             # Dijkstra cost conversion policy
│   └── train.py                    # Legacy sklearn training script (experimental)
├── tests/
│   ├── test_api_mocked.py          # Unit tests for FastAPI endpoints (offline, mocked)
│   ├── test_predictor_mocked.py    # Unit tests for predictor & batching (offline, mocked)
│   ├── test_routing_cost.py        # Unit tests for cost calculation & boundaries
│   └── test_smoke_real_model.py    # Live smoke test using real amazon/chronos-2 weights
├── .gitignore
├── README.md
└── requirements.txt
```

---

## 4. Python Environment & Installation

Python 3.10 to 3.13 is supported.

```bash
# 1. Create and activate a virtual environment
python -m venv .venv

# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

# 2. Upgrade pip and install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

---

## 5. Dataset Arrangement

Derived from the Abilene backbone traffic dataset (sampled at 5-minute intervals).

| Split | Period | Row Count |
|---|---|---:|
| **Train** | 2004-03-01 to 2004-07-30 (18 weeks) | ~1,085,000 |
| **Validation** | 2004-07-31 to 2004-08-19 (3 weeks) | ~180,900 |
| **Test** | 2004-08-21 to 2004-09-10 (3 weeks) | ~180,900 |

### Expected Directory Layout
The default loader expects datasets in a sibling `dataset/` directory:
```
computer network project/
├── dataset/
│   ├── abilene_ml_train.csv/abilene_ml_train.csv  (or abilene_ml_train.csv)
│   ├── abilene_ml_val.csv/abilene_ml_val.csv      (or abilene_ml_val.csv)
│   └── abilene_ml_test.csv/abilene_ml_test.csv    (or abilene_ml_test.csv)
└── prediction_layer/
```

### Environment Variables
- `DATASET_DIR`: Path to the dataset folder if located elsewhere:
  ```bash
  set DATASET_DIR=C:\path\to\dataset
  ```
- `SKIP_REAL_MODEL_TESTS=1`: Set to skip real Chronos-2 model initialization in unit tests when offline.

---

## 6. Critical Utilization Units Convention

> [!WARNING]
> In the Abilene dataset:
> $$\text{utilization\_pct} = \left(\frac{\text{traffic\_kbps}}{\text{capacity\_kbps}}\right) \times 100$$
> Values are **already scaled to percentage-points (0.0 to 100.0)**.
> - A stored value of `0.0597` means **0.0597%**, NOT 5.97%.
> - A stored value of `50.0` means **50.0%**.
> - Peak test set utilization is approximately **75.0%**.
>
> **NEVER multiply an existing `utilization_pct` value by 100 again.**

In code and APIs:
- `predicted_utilization_percent`: 0.0 to 100.0 scale (primary).
- `predicted_utilization` / `current_utilization`: fractional 0.0 to 1.0 (for downstream compatibility).

---

## 7. Model Roles & Evaluation Methodology

### Roles
1. **Primary Production Predictor**: `amazon/chronos-2`
   - Pretrained zero-shot foundation model (`Chronos2Pipeline`).
   - No task fine-tuning required. Loaded from Hugging Face cache on first use.
   - Generates 21 quantiles; median forecast is extracted at index 10.
2. **Production Baseline & Fallback**: `Moving Average` (`util_mean_3`)
   - Computes rolling average over the last 3 observations (15 minutes).
   - Zero compute overhead, high reliability fallback.
3. **Legacy / Experimental Models**: `src/train.py`
   - Trains Linear Regression, Random Forest, XGBoost (`models/final_model.pkl`).
   - Kept separated from the primary zero-shot inference pipeline.

---

## 8. Benchmark Results & Verification

### A. Validation Set Benchmark (2,000 chronological samples)
*All models evaluated on identical validation samples:*

| Model | MAE | RMSE | R² | Latency |
|---|---:|---:|---:|---:|
| **Moving Average** (`util_mean_3`) | **0.1772** | **0.3882** | **0.9179** | 0.00 ms/sample |
| **amazon/chronos-2** (univariate zero-shot) | 0.1788 | 0.4200 | 0.9039 | 0.83 ms/sample |
| **amazon/chronos-2 + past covariates** | 0.1805 | 0.4169 | 0.9053 | 3.86 ms/sample |
| **Persistence** | 0.1804 | 0.4252 | 0.9015 | 0.00 ms/sample |
| **amazon/chronos-t5-tiny** | 0.1820 | 0.4338 | 0.8974 | 0.77 ms/sample |

### B. Full Test Set Benchmark (180,900 samples, 1,091 congested events)
*Evaluated on out-of-sample peak traffic:*

| Model | Test MAE | Test RMSE | Test R² | Test Recall | Test Precision | False Negatives |
|---|---:|---:|---:|---:|---:|---:|
| **amazon/chronos-2** | **0.2337** | **1.0118** | **0.9675** | **97.62%** | 95.86% | **26 / 1,091** |
| **Moving Average** | 0.2493 | 1.0799 | 0.9630 | 96.33% | **97.59%** | 40 / 1,091 |

*(See `reports/evaluation_discrepancy_audit.md` for historical attribution details).*

---

## 9. Starting the FastAPI Service

```bash
uvicorn src.api:app --host 0.0.0.0 --port 8000 --reload
```

Interactive OpenAPI docs: `http://localhost:8000/docs`

### API Endpoints
- `GET  /health`          — Check model readiness and device.
- `GET  /model-info`      — View configuration, threshold, and metrics.
- `POST /predict`         — Single-link 5-minute forecast.
- `POST /predict/batch`   — True batched forecast with per-item error isolation.
- `POST /routing-cost`    — Convert predicted utilization to Dijkstra cost.

---

## 10. Example API Invocations

### Single Prediction (`POST /predict`)
```bash
curl -X POST http://localhost:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "link": "ATLA-WASH",
    "utilization_pct": 52.0,
    "util_lag_1": 48.0,
    "util_lag_2": 45.0,
    "util_lag_3": 42.0,
    "util_lag_4": 40.0,
    "util_lag_5": 38.0
  }'
```

**Response**:
```json
{
  "link": "ATLA-WASH",
  "timestamp": "",
  "model": "amazon/chronos-2",
  "prediction_horizon_minutes": 5,
  "current_utilization": 0.52,
  "predicted_utilization": 0.548,
  "predicted_utilization_percent": 54.8,
  "congestion_risk": "HIGH",
  "status": "ok"
}
```

### Routing Cost Calculation (`POST /routing-cost`)
```bash
curl -X POST http://localhost:8000/routing-cost \
  -H "Content-Type: application/json" \
  -d '{
    "predicted_utilization_percent": 54.8,
    "current_metrics": {"link": "ATLA-WASH"}
  }'
```

**Response**:
```json
{
  "link": "ATLA-WASH",
  "predicted_utilization": 0.548,
  "predicted_utilization_percent": 54.8,
  "predicted_cost": 106.48,
  "risk": "HIGH"
}
```

---

## 11. Running Unit Tests

Execute the fast, offline unit test suite:
```bash
python -m pytest tests/test_routing_cost.py tests/test_predictor_mocked.py tests/test_api_mocked.py -v
```

To run the live smoke test using real model weights (requires internet or cached model):
```bash
python -m pytest tests/test_smoke_real_model.py -v -s
```

For complete reproduction commands, inspect `docs/VERIFICATION_PLAN.md`.
