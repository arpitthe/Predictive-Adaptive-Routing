# Presentation Runbook: Complete System Operation & Faculty Demonstration

**Project**: Predictive AI-Assisted Adaptive Routing  
**Classification**: Academic & Technical Evaluation Guide  
**Date**: November 2026  
**System Architecture**: Frontend (React) + Backend (Node.js) + ML (Python Chronos-2) + Routing (Dijkstra) + Network Emulation (GNS3)  

---

## 1. Prerequisites Checklist

Ensure the following runtimes are installed on the demonstration machine:
- **Node.js**: v18.0.0 or later (v20+ recommended)
- **Python**: 3.10 or 3.11 with PyTorch, FastAPI, and Chronos installed
- **Web Browser**: Chrome, Edge, or Firefox

---

## 2. One-Time Manual Package Installation

Run these commands once in PowerShell before the presentation:

### A. Python Prediction Layer Dependencies
```powershell
cd "c:\Coding\computer network project\prediction_layer"
pip install -r requirements.txt
```

### B. Node.js Backend Dependencies
```powershell
cd "c:\Coding\computer network project\prediction_layer\backend"
npm install
```

### C. React Frontend Dependencies
```powershell
cd "c:\Coding\computer network project\frontend"
npm install
```

---

## 3. Database-Free Configuration (`.env`)

Verify that the backend is set to run in in-memory mode so that MongoDB is **not** required.

Inspect `backend/.env`:
```ini
PORT=5001
STORAGE_MODE=memory
SEED_DEMO_DATA=true
CORS_ORIGIN=*
ML_SERVICE_URL=http://127.0.0.1:8000
GNS3_SERVER_URL=http://127.0.0.1:3080
GNS3_PROJECT_ID=
```

---

## 4. Service Startup Order (Exact PowerShell Commands)

Open **3 separate PowerShell windows** and run the services in this exact order:

### Terminal 1: Python FastAPI Prediction Layer (Port 8000)
```powershell
cd "c:\Coding\computer network project\prediction_layer"
uvicorn src.api:app --host 127.0.0.1 --port 8000 --workers 1
```
**Expected Terminal Output**:
```text
INFO:     Started server process [PID]
INFO:     Waiting for application startup.
INFO:     [Prediction Layer Lifespan] Loading Chronos predictor (amazon/chronos-2)...
INFO:     [Prediction Layer Lifespan] Model loaded successfully on device: cuda (or cpu).
INFO:     Application startup complete.
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
```

### Terminal 2: Node.js Orchestrator Backend (Port 5001)
```powershell
cd "c:\Coding\computer network project\prediction_layer\backend"
npm run dev
```
**Expected Terminal Output**:
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
GNS3:         http://localhost:5001/api/gns3/status
-----------------------------------------
[Storage] In-memory storage mode active (MongoDB not required).
[Storage] Seeded demo topology: 6 routers, 8 links, 96 telemetry observations.
```

### Terminal 3: React Frontend Console (Port 3000)
```powershell
cd "c:\Coding\computer network project\frontend"
npm run dev
```
**Expected Terminal Output**:
```text
  VITE v5.1.6  ready in 240 ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
  ➜  press h + enter to show help
```

---

## 5. System Health Verification URLs

Verify all layers are green before speaking to faculty:

1. **Python Prediction Layer**:
   - URL: `http://127.0.0.1:8000/health`
   - Expected JSON: `{"status": "healthy", "model": "amazon/chronos-2", "device": "cuda"|"cpu"}`
2. **Node.js Orchestrator Backend**:
   - URL: `http://127.0.0.1:5001/api/health`
   - Expected JSON: `{"status": "healthy", "storageMode": "memory", "mlService": {"available": true, "modelLoaded": true}, ...}`
3. **Frontend Application**:
   - Open browser at: `http://localhost:3000/`

---

## 6. Faculty Demonstration Sequence (5–7 Minutes)

Follow this structured script during your evaluation:

### Minute 1: The Core Problem & Architectural Overview (Overview Tab)
- **Show**: Point to the **Overview Dashboard** displaying the 6-router, 8-link nationwide core backbone.
- **Narrate**: *"Traditional routing protocols like OSPF or standard Dijkstra route traffic solely based on static hop counts or static link latency. When sudden surges or gradual traffic buildup occurs, static protocols keep sending packets across the same links until buffers overflow and packets drop. Our project introduces Predictive AI-Assisted Adaptive Routing: using Amazon Chronos-2, we forecast link utilization 5 minutes ahead of time and proactively steer traffic onto alternative paths before congestion occurs."*
- **Highlight**: Point out the live telemetry metrics, the data source indicator showing `DEMO REPLAY (IN-MEMORY)`, and the active Chronos-2 model status badge.

### Minute 2: Interactive Topology & Telemetry (Network Topology Tab)
- **Show**: Open **Network Topology**. Click on **R1** (New York) and **R6** (San Jose).
- **Show**: Click on link **L5-6** (Denver $\to$ San Jose) and **L2-4** (Chicago $\to$ Dallas).
- **Explain**: *"Notice that links L5-6 and L2-4 have high utilization ($\ge 50\%$), highlighted in rose red. The system monitors 5-minute sampling windows for each link."*

### Minute 3: Chronos-2 Time-Series Forecasting (Prediction Intelligence Tab)
- **Show**: Navigate to **Prediction Intelligence**.
- **Action**: Select link **L1-2** and click **"Trigger Forecast"**.
- **Explain**: *"The frontend just dispatched an HTTP request through our Node.js backend directly to our Python FastAPI service. Chronos-2 took the 6 historical lag observations ($t-25\text{m} \dots t$) and predicted the next 5-minute utilization. Below 50%, cost equals utilization. Above 50%, our non-linear exponential penalty function activates: $\text{Cost} = U + 2.5(U - 50)^{1.3}$."*

### Minute 4: Adaptive Route Calculation & Comparison (Adaptive Routing Tab)
- **Show**: Navigate to **Adaptive Routing**. Select Source: **R1**, Destination: **R6**.
- **Action**: Click **"Compute Route"**.
- **Demonstration Punchline**:
  - Show the side-by-side comparison:
  - **Conventional Path**: `R1 -> R2 -> R5 -> R6` (uses link L5-6 with 72% load, leading to bottlenecking).
  - **Predictive Adaptive Path**: `R1 -> R3 -> R4 -> R6` (bypasses L5-6 and L2-4, utilizing the lower-cost southern path).
  - Show the topology graph automatically highlighting the chosen path in animated cyan!

### Minute 5: Dynamic Time Stepping & GNS3 Status (Demo Control Bar & Health Tab)
- **Action**: Click **"Step Replay (+5m)"** in the top flight controller bar.
- **Show**: The logical time advances 5 minutes, new telemetry observations are recorded, and charts refresh instantly.
- **Show**: Navigate to **System Health**. Show that all services are green, storage is running database-free in `memory` mode, and GNS3 is in `standby` mode ready for live network attachment.

---

## 7. Troubleshooting & Recovery Procedures

| Symptom | Cause | Solution |
| :--- | :--- | :--- |
| **Backend reports 503 "Cannot connect to Python ML service"** | Python FastAPI is not running on port 8000 | Open Terminal 1, run `uvicorn src.api:app --host 127.0.0.1 --port 8000` |
| **Backend exits on startup with MongoDB error** | `STORAGE_MODE` is set to `mongodb` instead of `memory` | Edit `backend/.env` and ensure `STORAGE_MODE=memory` |
| **Frontend displays "Failed to fetch topology"** | Backend is not running on port 5001 or blocked by firewall | Ensure Node.js backend is running in Terminal 2 (`npm run dev`) |
| **Topology shows 0 links or routers** | Demo seeding was skipped | Click **"Reseed Baseline"** in the top Demo Flight Controller bar or call `POST /api/telemetry/seed` |
| **Port 3000, 5001, or 8000 already in use** | An old process is still bound to the port | Run `Get-Process -Id (Get-NetTCPConnection -LocalPort <PORT>).OwningProcess | Stop-Process -Force` |

---

## 8. Safe Shutdown Procedure

To cleanly stop all demonstration services:
1. In Terminal 3 (Frontend): Press `Ctrl + C` and type `y`.
2. In Terminal 2 (Backend): Press `Ctrl + C` and type `y`.
3. In Terminal 1 (Python ML): Press `Ctrl + C`.

