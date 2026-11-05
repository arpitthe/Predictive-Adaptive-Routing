# Database-Free Demonstration Mode Guide

**Project**: Predictive AI-Assisted Adaptive Routing  
**Mode**: In-Memory Demonstration Architecture (`STORAGE_MODE=memory`)  
**Target Audience**: Faculty Evaluation, Integration Demonstrations & Local Testing  

---

## 1. Executive Summary

This guide details how to operate the complete **Predictive AI-Assisted Adaptive Routing** stack in a standalone, database-free configuration.

In demonstration mode, the Node.js backend runs with a built-in in-memory storage engine instead of requiring a running MongoDB instance. The backend boots instantly, loads a deterministic 6-router, 8-link core network topology, seeds 12 historical 5-minute telemetry samples per link, and interfaces directly with the Python FastAPI Chronos-2 service and the Dijkstra routing engine.

```
+-----------------------------------------------------------------------------------+
|                         Faculty Demonstration Architecture                        |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  [ Frontend Web App ] (Port 3000 / 5173)                                          |
|         │                                                                         |
|         ▼ HTTP REST (CORS enabled)                                                |
|  [ Node.js Backend Orchestrator ] (Port 5001)                                    |
|         ├─ In-Memory Storage Engine (STORAGE_MODE=memory)                         |
|         │    • Deterministic 6-Router, 8-Link Topology                            |
|         │    • 12-sample historical rolling buffer per link                       |
|         │    • Accelerated 5-minute replay step engine                            |
|         ├─ Dijkstra Routing Engine                                                |
|         └─ Centralized REST ML Client                                             |
|         │                                                                         |
|         ▼ HTTP POST /predict/batch & /routing-cost                                |
|  [ Python FastAPI Prediction Layer ] (Port 8000)                                  |
|         ├─ amazon/chronos-2 (Vectorized Batch Inference)                          |
|         └─ Authoritative Piece-Wise Routing Cost Evaluator                        |
|                                                                                   |
|  [ GNS3 Real-Time Network Monitor ] (Future / Live Ingestion)                     |
|         └─ Streams telemetry directly into POST /api/telemetry (source: "gns3")    |
+-----------------------------------------------------------------------------------+
```

---

## 2. Quickstart: 3-Step Demonstration Startup

### Step 1: Start the Python Prediction Layer
From the repository root (`prediction_layer/`):
```bash
uvicorn src.api:app --host 127.0.0.1 --port 8000 --workers 1
```
*Health verification*:
```bash
curl -s http://127.0.0.1:8000/health
# Expected: {"status": "healthy", "model": "amazon/chronos-2", "device": "cuda"|"cpu"}
```

### Step 2: Configure & Start Node.js Backend in Memory Mode
From `prediction_layer/backend/`:
```bash
# Ensure .env has STORAGE_MODE=memory
cp .env.example .env
```
Verify the `.env` settings:
```ini
PORT=5001
STORAGE_MODE=memory
SEED_DEMO_DATA=true
CORS_ORIGIN=*
ML_SERVICE_URL=http://127.0.0.1:8000
```
Start the backend:
```bash
npm run dev
# OR: npm start
```
*Console output will display*:
```text
-----------------------------------------
PREDICTIVE ADAPTIVE ROUTING BACKEND
-----------------------------------------
Server:       http://localhost:5001
Storage Mode: MEMORY
Health:       http://localhost:5001/api/health
Routers:      http://localhost:5001/api/routers
Links:        http://localhost:5001/api/links
Topology:     http://localhost:5001/api/topology
Telemetry:    http://localhost:5001/api/telemetry
Predictions:  http://localhost:5001/api/predictions
Routing:      http://localhost:5001/api/routing
-----------------------------------------
[Storage] In-memory storage mode active (MongoDB not required).
[Storage] Seeded demo topology: 6 routers, 8 links, 96 telemetry observations.
```

### Step 3: Verify the Integrated System Health
```bash
curl -s http://127.0.0.1:5001/api/health
```
**Expected Output**:
```json
{
  "success": true,
  "status": "healthy",
  "message": "Predictive Adaptive Routing Backend is fully operational",
  "backend": "online",
  "storageMode": "memory",
  "storage": {
    "mode": "memory",
    "status": "ready",
    "routerCount": 6,
    "linkCount": 8,
    "telemetryCount": 96,
    "decisionCount": 0,
    "database": "not_required"
  },
  "mlService": {
    "available": true,
    "modelLoaded": true,
    "modelId": "amazon/chronos-2",
    "device": "cuda",
    "error": null
  },
  "gns3": {
    "connected": false,
    "status": "standby",
    "ingestionReady": true,
    "note": "Accepts live telemetry stream via POST /api/telemetry with source='gns3'"
  }
}
```

---

## 3. Demo Topology & Telemetry Profiles

The built-in sample network contains 6 core routers and 8 bidirectional links:

| Link ID | Routers | Bandwidth | Base Utilization | 12-Sample Trend | Expected Congestion Risk |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **L1-2** | R1 $\leftrightarrow$ R2 | 1000 Mbps | 42.0% | Moderate fluctuations (38%–45%) | `LOW` |
| **L1-3** | R1 $\leftrightarrow$ R3 | 1000 Mbps | 25.0% | Stable low load (23%–26%) | `LOW` |
| **L2-4** | R2 $\leftrightarrow$ R4 | 1000 Mbps | 68.0% | **Rising curve** (38% $\to$ 68%) | **`HIGH`** (Congestion threshold crossed) |
| **L2-5** | R2 $\leftrightarrow$ R5 | 1000 Mbps | 35.0% | Moderate load | `LOW` |
| **L3-4** | R3 $\leftrightarrow$ R4 | 1000 Mbps | 28.0% | Low load | `LOW` |
| **L4-5** | R4 $\leftrightarrow$ R5 | 1000 Mbps | 48.0% | Approaching threshold (48%) | `LOW` |
| **L4-6** | R4 $\leftrightarrow$ R6 | 1000 Mbps | 44.0% | Moderate load | `LOW` |
| **L5-6** | R5 $\leftrightarrow$ R6 | 1000 Mbps | 72.0% | **Persistent heavy load** (68%–75%) | **`HIGH`** (Heavily penalized) |

Every link is pre-populated with **12 chronological observations spaced exactly 5 minutes apart** ($t-55\text{m}, t-50\text{m}, \dots, t$), tagged with `source: "demo_seed"`.

---

## 4. Demonstrating Faculty Scenarios

### Scenario A: Compute Optimal Predictive Route
Request Dijkstra to find the best route between `R1` (New York) and `R6` (San Jose):
```bash
curl -X POST http://127.0.0.1:5001/api/routing/compute \
  -H "Content-Type: application/json" \
  -d '{"sourceRouter": "R1", "destinationRouter": "R6"}'
```
**Demonstration Highlight**:
- Watch the backend make a **single batch call** to `POST /predict/batch` for all 8 links simultaneously.
- Link `L5-6` and `L2-4` will be flagged with `congestionRisk: "HIGH"` and assigned steep penalties ($\text{Cost} > 100$).
- Dijkstra automatically routes around congested links, choosing the lower-cost path through `R1 -> R3 -> R4 -> R6` rather than `R1 -> R2 -> R4` or through `R5 -> R6`.

### Scenario B: Accelerated Time Replay Step
Faculty often want to see how the network reacts when traffic shifts over time:
```bash
curl -X POST http://127.0.0.1:5001/api/telemetry/replay-step
```
**Demonstration Highlight**:
- Advances the logical simulation time by exactly 5 minutes.
- Ingests new telemetry for all 8 links tagged with `source: "replay"`.
- Recomputing the route reflects the dynamic adaptation of the predictive routing engine!

### Scenario C: Reseeding / Resetting Topology
To reset the demonstration back to its pristine initial state:
```bash
curl -X POST http://127.0.0.1:5001/api/telemetry/seed
```

---

## 5. Frontend & UI Integration

The frontend web application connects to the backend through standard REST endpoints. CORS is configured to accept connections from any origin (`CORS_ORIGIN=*` by default) or specific URLs like `http://localhost:3000` or `http://localhost:5173`.

### Key Endpoints for UI Panels:
| UI Component | Backend Endpoint | Content |
| :--- | :--- | :--- |
| **Topology Map** | `GET /api/topology` | Routers (positions/IPs) and links with live utilization |
| **Router List** | `GET /api/routers` | Node status, locations, and IPs |
| **Link Telemetry Chart** | `GET /api/telemetry/link/:linkId` | Historical time-series array in chronological order |
| **Route Calculator** | `POST /api/routing/compute` | Chosen path, alternative paths, and cost breakdowns |
| **Decision History** | `GET /api/routing/decisions` | Past routing decisions and audit trail |
| **Health Indicator** | `GET /api/health` | Backend, storage, and ML readiness status |

---

## 6. GNS3 Telemetry Ingestion Compatibility

When connecting the real-time GNS3 monitoring agent, configure it to post measurements directly to the Node.js backend:
```bash
curl -X POST http://127.0.0.1:5001/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "linkId": "L1-2",
    "utilizationPct": 56.4,
    "throughputMbps": 564.0,
    "packetLossPct": 0.01,
    "source": "gns3",
    "measuredAt": "2026-11-05T04:30:00Z"
  }'
```
- In-memory storage buffers GNS3 telemetry per link seamlessly without needing MongoDB.
- Live GNS3 telemetry is recorded with `source: "gns3"`, distinct from seed/replay data.

---

## 7. Switching to MongoDB Later

When migrating from demonstration mode to persistent production storage, no application code needs to be modified:

1. **Start MongoDB**:
   ```bash
   mongod --dbpath /data/db
   ```
2. **Update `.env`**:
   ```ini
   STORAGE_MODE=mongodb
   MONGODB_URI=mongodb://127.0.0.1:27017/predictive_routing
   ```
3. **Restart the Node.js backend**:
   ```bash
   npm run start
   ```
The Mongoose models (`NetworkRouter`, `NetworkLink`, `Telemetry`, `RoutingDecision`) automatically connect to the MongoDB replica set or standalone instance.

