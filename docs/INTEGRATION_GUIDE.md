# Integration Guide: Prediction & Machine Learning Layer

**Project**: Predictive AI-Assisted Adaptive Routing  
**Module**: `prediction_layer`  
**Collaborators**:
- **Daksh**: Network Monitoring, GNS3 Telemetry & Controller Layer
- **Ritu**: Adaptive Routing Engine (Dijkstra)
- **ML Layer**: Link Utilization Forecasting & Cost Policy

---

## 1. Architectural Boundary & Separation of Concerns

```
[GNS3 Emulated Network]
         │
         ▼ (SNMP / NetFlow / Telemetry Collection)
[Daksh's Monitoring Controller]
   • Gathers link bytes and calculates traffic_kbps & utilization_pct
   • Maintains per-link rolling history (sliding buffer of 6+ observations)
         │
         │ (HTTP REST or In-Process Python API)
         ▼
[Prediction & ML Layer]
   • Model: amazon/chronos-2 (zero-shot foundation model)
   • Forecasts next-5-minute utilization (continuous 0–100% scale)
   • Evaluates congestion risk (LOW / HIGH against configurable 50% threshold)
   • Translates forecasted condition into routing cost
         │
         │ (Edge Weights: link -> predicted_cost)
         ▼
[Ritu's Dijkstra Routing Engine]
   • Consumes predicted link costs as graph edge weights
   • Computes dynamic shortest paths
   • Installs proactive routing adaptations before queues overflow
```

> [!IMPORTANT]
> **Strict System Boundaries**:
> - The Prediction Layer **never** computes Dijkstra paths, selects routes, or pushes router configuration.
> - The Prediction Layer does not collect SNMP packets directly; it consumes structured telemetry from Daksh's controller.
> - Routing adaptation is performed downstream by Ritu's routing engine using edge weights computed here.

---

## 2. Integration Modes

The Prediction Layer supports two primary integration patterns:

### Pattern A: In-Process Python API (Recommended for Local Benchmarking)
Avoids HTTP network latency and JSON serialization overhead when modules run in the same Python environment.

```python
from src.integration import LinkConditionPipeline

# Initialize once (keeps Chronos-2 loaded in memory)
pipeline = LinkConditionPipeline()

# Telemetry collected by Daksh's controller for 30 directed links
telemetry_batch = [
    {
        "link": "ATLA-CHIC",
        "capacity_kbps": 9920000.0,
        "traffic_kbps": 3200000.0,
        "utilization_pct": 32.25,
        "util_lag_1": 31.0,
        "util_lag_2": 30.5,
        "util_lag_3": 29.8,
        "util_lag_4": 28.0,
        "util_lag_5": 27.5,
        "timestamp": "2026-11-05T01:30:00Z",
    },
    # ... additional links ...
]

# Process entire topology concurrently using true GPU/CPU batching
link_updates = pipeline.process_telemetry_batch(telemetry_batch)

# Format passed directly to Ritu's Dijkstra engine:
# { "ATLA-CHIC": 4.25, "CHIC-ATLA": 1.15, ... }
dijkstra_weights = {item["link"]: item["predicted_cost"] for item in link_updates}
```

---

### Pattern B: HTTP REST API (Recommended for Distributed / Microservice Setup)
Run the Prediction Layer as an independent microservice:
```bash
uvicorn src.api:app --host 0.0.0.0 --port 8000
```

#### B.1 Single-Link Forecast: `POST /predict`
- **URL**: `http://localhost:8000/predict`
- **Method**: `POST`
- **Request Headers**: `Content-Type: application/json`

**Request Body**:
```json
{
  "link": "ATLA-WASH",
  "link_index": 1,
  "capacity_kbps": 9920000.0,
  "traffic_kbps": 5200000.0,
  "utilization_pct": 52.42,
  "util_lag_1": 49.50,
  "util_lag_2": 47.10,
  "util_lag_3": 44.00,
  "util_lag_4": 41.20,
  "util_lag_5": 38.00,
  "timestamp": "2026-11-05T01:30:00Z"
}
```

**Response Body (200 OK)**:
```json
{
  "link": "ATLA-WASH",
  "timestamp": "2026-11-05T01:30:00Z",
  "model": "amazon/chronos-2",
  "prediction_horizon_minutes": 5,
  "current_utilization": 0.5242,
  "predicted_utilization": 0.5510,
  "predicted_utilization_percent": 55.10,
  "congestion_risk": "HIGH",
  "status": "ok"
}
```

---

#### B.2 Batch Forecast: `POST /predict/batch`
Evaluates all topology links in a single efficient neural forward pass.

- **URL**: `http://localhost:8000/predict/batch`
- **Method**: `POST`

**Request Body**:
```json
[
  {
    "link": "R1-R2",
    "utilization_pct": 12.5,
    "util_lag_1": 12.0,
    "util_lag_2": 11.8,
    "util_lag_3": 11.5,
    "util_lag_4": 11.0,
    "util_lag_5": 10.5
  },
  {
    "link": "R2-R3",
    "utilization_pct": 68.0,
    "util_lag_1": 64.0,
    "util_lag_2": 61.0,
    "util_lag_3": 58.0,
    "util_lag_4": 55.0,
    "util_lag_5": 50.0
  }
]
```

**Response Body (200 OK)**:
```json
[
  {
    "link": "R1-R2",
    "timestamp": "",
    "model": "amazon/chronos-2",
    "prediction_horizon_minutes": 5,
    "current_utilization": 0.125,
    "predicted_utilization": 0.131,
    "predicted_utilization_percent": 13.1,
    "congestion_risk": "LOW",
    "status": "ok"
  },
  {
    "link": "R2-R3",
    "timestamp": "",
    "model": "amazon/chronos-2",
    "prediction_horizon_minutes": 5,
    "current_utilization": 0.680,
    "predicted_utilization": 0.714,
    "predicted_utilization_percent": 71.4,
    "congestion_risk": "HIGH",
    "status": "ok"
  }
]
```

---

#### B.3 Routing Cost Conversion: `POST /routing-cost`
Converts forecasted utilization into a Dijkstra-ready weight.

- **URL**: `http://localhost:8000/routing-cost`
- **Method**: `POST`

**Request Body**:
```json
{
  "predicted_utilization_percent": 71.4,
  "current_metrics": {
    "link": "R2-R3"
  }
}
```

**Response Body (200 OK)**:
```json
{
  "link": "R2-R3",
  "predicted_utilization": 0.714,
  "predicted_utilization_percent": 71.4,
  "predicted_cost": 108.14,
  "risk": "HIGH"
}
```

---

## 3. Cost Function Formula for Dijkstra

The routing cost is calculated deterministically as follows:

$$\text{base\_cost} = 1.0$$
$$\text{cost} = \text{base\_cost} + \frac{\text{predicted\_utilization\_percent}}{10.0}$$
$$\text{if } \text{predicted\_utilization\_percent} > 50.0\%: \quad \text{cost} += 100.0$$

### Key Properties:
1. **Always Finite and $\ge 1.0$**: Dijkstra algorithms require strictly non-negative edge weights.
2. **Proactive Congestion Avoidance**: When utilization crosses 50.0%, the $+100.0$ penalty ensures Dijkstra reroutes alternate traffic around the congested bottleneck before packet loss occurs.
3. **Smooth Progression**: Below 50.0%, links scale gently ($1.0 \to 6.0$), preferring links with more headroom.

---

## 4. History Buffer Specification (For Daksh)

Chronos-2 is a univariate time-series foundation model.
- **Default Window**: 6 observations (30 minutes total at 5-minute sampling intervals).
- **Extended History**: Callers may optionally provide a `"history": [...]` array of floating-point numbers ($\ge 2$ points, oldest to newest). The prediction engine will dynamically evaluate forecasts over the longer context window.
- **Buffering Recommendation**: The controller should maintain a ring buffer (e.g. `collections.deque(maxlen=36)`) per link. When starting, minimum 2 points are required; once 6 points are collected, lag columns or the full buffer can be passed directly.

