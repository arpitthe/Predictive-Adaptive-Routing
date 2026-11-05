# System Integration Guide: Node.js Backend & Python Prediction Layer

**Project**: Predictive AI-Assisted Adaptive Routing  
**Module**: End-to-End Backend & ML System Integration  
**Date**: November 2026  
**Status**: Production-Ready Integration Architecture  

---

## 1. Architecture Overview

The system couples a high-concurrency Node.js telemetry and orchestration backend with an authoritative Python ML inference microservice powered by Amazon Chronos-2.

```
       +-------------------------------------------------------------+
       |                       Telemetry Sources                     |
       |             (Network Simulator / GNS3 / SNMP)               |
       +------------------------------+------------------------------+
                                      | HTTP POST /api/telemetry
                                      v
       +-------------------------------------------------------------+
       |             Node.js Backend Orchestrator (Port 5001)        |
       |                                                             |
       |  - Ingests & stores telemetry (MongoDB)                     |
       |  - Validates 5-minute sampling intervals & lag windows      |
       |  - Orchestrates route computation requests                  |
       |  - prediction.service.js: Centralized ML REST client        |
       +------------------------------+------------------------------+
                                      |
                     REST (HTTP/JSON) | Batch POST /predict/batch
                     ML_SERVICE_URL   | POST /routing-cost
                                      v
       +-------------------------------------------------------------+
       |            Python ML Service — FastAPI (Port 8000)          |
       |                                                             |
       |  - Pretrained amazon/chronos-2 foundation model             |
       |  - Vectorized GPU/CPU batch inference (torch.inference_mode)|
       |  - Moving Average fallback mechanism (if explicitly enabled)|
       |  - Authoritative routing cost calculation & risk tagging    |
       +------------------------------+------------------------------+
                                      |
                   Link Costs & Risks | Evaluated Topology
                                      v
       +-------------------------------------------------------------+
       |             Dijkstra Routing Engine (in Backend)            |
       |                                                             |
       |  - Weighted directed/bidirectional graph traversal          |
       |  - High penalty cost (500) applied to failed/unready links  |
       |  - Generates optimal path & persists RoutingDecision        |
       +-------------------------------------------------------------+
```

---

## 2. Component Separation of Responsibilities

| Component | Owner | Responsibilities | Forbidden Actions |
| :--- | :--- | :--- | :--- |
| **Node.js Backend** | Daksh | • Ingests telemetry from simulator/GNS3<br>• Manages router & link metadata<br>• Persists telemetry to MongoDB<br>• Validates 6 observations at 5-min intervals<br>• Orchestrates batch predictions via REST<br>• Runs Dijkstra path selection & persists decisions | • Never duplicate Chronos or ML inference in JS<br>• Never recalculate custom cost formulas in JS<br>• Never self-call internal HTTP endpoints |
| **Python ML Layer** | Arpit | • Loads and manages `amazon/chronos-2`<br>• Executes batched univariate time-series forecasts<br>• Provides Moving Average fallback<br>• Calculates piece-wise routing costs & risk flags<br>• Exposes `/health`, `/predict`, `/predict/batch`, `/routing-cost` | • Never run Dijkstra or select end-to-end paths<br>• Never modify router interfaces or topology<br>• Never drop batch response ordering |
| **Routing Engine** | Ritu | • Constructs graph topology<br>• Computes shortest paths using ML-assigned link costs<br>• Fallback path re-routing on link failures | • Never alter ML cost weights arbitrarily<br>• Never accept negative or non-finite costs |

---

## 3. Communication Protocols & Contracts

Communication between Node.js and Python occurs strictly over HTTP/REST with JSON payloads. Direct in-process importing is prohibited due to distinct runtimes (Node.js ESM vs Python 3.10+).

### 3.1 Base Configuration & Environment Variables

| Variable | Default Value | Description |
| :--- | :--- | :--- |
| `PORT` | `5001` | Node.js Express server port |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/predictive_routing` | MongoDB connection string |
| `ML_SERVICE_URL` | `http://127.0.0.1:8000` | Base URL of Python FastAPI prediction microservice |
| `ML_PREDICT_TIMEOUT_MS` | `120000` | Timeout for single-link inference (ms) |
| `ML_BATCH_TIMEOUT_MS` | `180000` | Timeout for topology-wide batch inference (ms) |
| `ML_COST_TIMEOUT_MS` | `15000` | Timeout for routing cost calculation (ms) |
| `ML_HEALTH_TIMEOUT_MS` | `5000` | Timeout for ML health check (ms) |

---

## 4. System Startup Order

To prevent startup races or degraded mode errors, components must be started in this exact sequence:

1. **MongoDB Service**:
   ```bash
   mongod --dbpath /data/db
   ```
2. **Python Prediction Microservice (FastAPI)**:
   ```bash
   cd prediction_layer
   uvicorn src.api:app --host 127.0.0.1 --port 8000 --workers 1
   ```
   *Verify startup*: `curl -s http://127.0.0.1:8000/health` should return `{"status": "healthy", ...}`.
3. **Node.js Backend Orchestrator**:
   ```bash
   cd prediction_layer/backend
   npm run start
   ```
   *Verify startup*: `curl -s http://127.0.0.1:5001/api/health` should return `{"status": "healthy", "database": "connected", "mlService": {"available": true, "modelLoaded": true}}`.

---

## 5. API Endpoints Contract Reference

### 5.1 Python Prediction Layer Endpoints (Port 8000)

#### `GET /health`
Returns model availability and hardware execution device.
```json
{
  "status": "healthy",
  "model": "amazon/chronos-2",
  "device": "cuda"
}
```

#### `POST /predict`
Performs single-link forecast. Context must contain `util_lag_5` through `utilization_pct` in chronological order (oldest to newest). All percentages are in 0–100 scale.

**Request**:
```json
{
  "link": "R1-R2",
  "link_index": 1,
  "capacity_kbps": 100000,
  "traffic_kbps": 45000,
  "utilization_pct": 45.0,
  "util_lag_1": 42.0,
  "util_lag_2": 39.0,
  "util_lag_3": 38.0,
  "util_lag_4": 35.0,
  "util_lag_5": 32.0,
  "timestamp": "2026-11-05T03:00:00Z"
}
```

**Response (HTTP 200)**:
```json
{
  "status": "ok",
  "link": "R1-R2",
  "predicted_utilization_percent": 48.25,
  "confidence_interval": { "lower": 44.1, "upper": 52.4 },
  "model": "amazon/chronos-2",
  "device": "cuda",
  "latency_ms": 14.2
}
```

#### `POST /predict/batch`
Batch inference for up to 30 topology links in a single vectorized forward pass.
* Request: Array of `PredictionRequest` objects.
* Response: Array of `PredictionResponse` objects preserving exact input order. Failed items contain `{"status": "error", "error": "...", "link": "..."}`.

#### `POST /routing-cost`
Converts predicted utilization into edge weights according to piece-wise congestion boundaries:
- Utilization $\le 50.0\%$: $C = \text{utilization}$ (Risk: `LOW`)
- Utilization $> 50.0\%$: $C = \text{utilization} + 2.5 \times (\text{utilization} - 50.0)^{1.3}$ (Risk: `HIGH`)

**Request**:
```json
{
  "predicted_utilization_percent": 65.0,
  "current_metrics": {
    "link": "R1-R2",
    "utilization_pct": 58.0
  }
}
```

**Response (HTTP 200)**:
```json
{
  "link": "R1-R2",
  "predicted_cost": 107.502,
  "risk": "HIGH",
  "predicted_utilization": 65.0,
  "baseline_utilization": 58.0
}
```

---

### 5.2 Node.js Backend Orchestrator Endpoints (Port 5001)

#### `GET /api/health`
Integrated health status reporting Node.js state, MongoDB connection, and Python ML service availability.
```json
{
  "success": true,
  "status": "healthy",
  "message": "Predictive Adaptive Routing Backend is fully operational",
  "database": "connected",
  "mlService": {
    "available": true,
    "modelLoaded": true,
    "modelId": "amazon/chronos-2",
    "device": "cuda",
    "error": null
  },
  "timestamp": "2026-11-05T03:30:00.000Z"
}
```

#### `POST /api/routing/compute`
Executes full predictive adaptive routing calculation.
1. Gathers topology links and historical telemetry in parallel.
2. Dispatches a single `predict/batch` request to the ML service.
3. Retrieves routing costs.
4. Executes Dijkstra shortest path algorithm.

**Request**:
```json
{
  "sourceRouter": "R1",
  "destinationRouter": "R6"
}
```

**Response (HTTP 200)**:
```json
{
  "success": true,
  "data": {
    "sourceRouter": "R1",
    "destinationRouter": "R6",
    "routerPath": ["R1", "R3", "R6"],
    "linkPath": ["L1-3", "L3-6"],
    "totalCost": 92.4,
    "algorithm": "Dijkstra",
    "routingPolicy": "Chronos-2 predictive utilization cost",
    "evaluatedLinks": [
      {
        "linkId": "L1-3",
        "predictedUtilizationPct": 42.1,
        "congestionRisk": "LOW",
        "routingCost": 42.1,
        "predictionStatus": "ok",
        "predictionModel": "amazon/chronos-2"
      }
    ]
  }
}
```

---

## 6. Telemetry Ingestion & GNS3 Resampling Requirements

### 6.1 Telemetry Cadence
Chronos-2 requires input history sampled at **5-minute (300 seconds) intervals**.
- Minimum observations: **6 consecutive samples** ($t-25\text{m}, t-20\text{m}, t-15\text{m}, t-10\text{m}, t-5\text{m}, t$).
- Permitted interval tolerance: **$\pm 60$ seconds** (gaps must be between 240s and 360s).

### 6.2 High-Frequency Telemetry Resampling (e.g., GNS3)
GNS3 and hardware packet monitors frequently emit data at 1-second to 10-second intervals.
> [!IMPORTANT]
> High-frequency telemetry must NOT be piped directly into Chronos-2. An aggregator or database view must resample high-frequency streams into 5-minute rolling averages before ingestion or prediction:
> $$\overline{U}_{\text{5min}} = \frac{1}{N} \sum_{i=1}^{N} U_{i}$$

---

## 7. Error Handling & Fallback Strategy

```
           +---------------------------------------------+
           |       Link Prediction Requested             |
           +----------------------+----------------------+
                                  |
                   Sufficient History (>= 6)?
                     /                         \
                   YES                          NO
                   /                             \
     +---------------------------+        +---------------------------+
     |   Batch ML Prediction     |        |   Assign HIGH PENALTY     |
     +-------------+-------------+        |   Cost = 500              |
                   |                      |   Status = insufficient   |
           ML Service Status?             +---------------------------+
             /           \
           200           Error / Timeout
           /               \
   +---------------+   +-----------------------------+
   | Normal Cost   |   | Fallback Enabled?           |
   | [1, 200]      |   |   /                 \       |
   +---------------+   |  YES                 NO     |
                       |  /                     \    |
                       | Moving Average    Assign 500|
                       | Cost Calculation  Penalty   |
                       +-----------------------------+
```

1. **ML Unreachable (`ECONNREFUSED` / `ETIMEDOUT`)**:
   - `predictSingle`: Throws classified error $\rightarrow$ HTTP 503 response.
   - `calculateBestRoute`: Captures failure, applies `HIGH_PENALTY_COST` (500) to affected links, logs warning, and completes Dijkstra with penalty weighting.
2. **Missing History**:
   - Returns HTTP 422 with detailed breakdown of available vs required observations.
   - Routing engine assigns penalty weight 500 without halting computation for remaining topology.
3. **Never Zero Cost**:
   - Failures NEVER map to 0 cost. A 0 cost would erroneously trick Dijkstra into treating broken or congested links as ideal paths.

---

## 8. Manual Verification Runbook

Execute these commands in order to verify system integration.

### Step 1: Verify Python ML Service
```bash
# Health check
curl -X GET http://127.0.0.1:8000/health

# Single prediction
curl -X POST http://127.0.0.1:8000/predict \
  -H "Content-Type: application/json" \
  -d '{
    "link": "R1-R2",
    "utilization_pct": 52.0,
    "util_lag_1": 48.0,
    "util_lag_2": 45.0,
    "util_lag_3": 40.0,
    "util_lag_4": 38.0,
    "util_lag_5": 35.0
  }'
```

### Step 2: Verify Routing Cost Function
```bash
curl -X POST http://127.0.0.1:8000/routing-cost \
  -H "Content-Type: application/json" \
  -d '{
    "predicted_utilization_percent": 65.0,
    "current_metrics": {"link": "R1-R2"}
  }'
# Expected cost: ~107.5, risk: HIGH
```

### Step 3: Verify Node.js Backend Integration
```bash
# Node.js Health (including ML status)
curl -X GET http://127.0.0.1:5001/api/health

# Route computation using batch prediction
curl -X POST http://127.0.0.1:5001/api/routing/compute \
  -H "Content-Type: application/json" \
  -d '{
    "sourceRouter": "R1",
    "destinationRouter": "R2"
  }'
```

