"""
api.py
======
FastAPI service for the Prediction & Machine Learning Layer.

Endpoints
---------
GET  /health          → predictor availability status
POST /predict         → single-link next-5-min utilization forecast
POST /predict/batch   → batch forecast with per-item error isolation
GET  /model-info      → configured model details (Chronos-2, HuggingFace zero-shot)
POST /routing-cost    → convert predicted utilization to Dijkstra routing cost

Unit convention:
----------------
All utilization fields are on the 0–100 percentage-point scale unless the
field name explicitly indicates a fraction (e.g. current_utilization and
predicted_utilization are fractional 0.0–1.0 for downstream compatibility;
predicted_utilization_percent is the definitive 0–100 field).
"""

import math
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Union

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.predictor import LinkUtilizationPredictor, DEFAULT_MODEL_ID
from src.routing_cost import prediction_to_routing_cost, load_config

# Global predictor instance
predictor: Optional[LinkUtilizationPredictor] = None
_startup_error: Optional[str] = None


def init_predictor():
    """Initializes the global predictor instance once."""
    global predictor, _startup_error
    try:
        predictor = LinkUtilizationPredictor.load()
        _startup_error = None
        print(f"[startup] Predictor loaded successfully: {predictor.model_id} on {predictor.device}")
    except Exception as exc:
        _startup_error = str(exc)
        predictor = None
        print(f"[startup] WARNING: Predictor failed to load: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Modern FastAPI lifespan event handler replacing deprecated on_event."""
    init_predictor()
    yield


app = FastAPI(
    title="Prediction & Machine Learning Layer API",
    description=(
        "Predictive AI-Assisted Adaptive Routing — Link Condition Forecast. "
        "Primary model: amazon/chronos-2 (zero-shot foundation model). "
        "Fallback: Moving Average."
    ),
    version="1.1.0",
    lifespan=lifespan,
)


# ── Request / Response schemas ─────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    """
    Input schema for single-link utilization forecast.
    All utilization fields are on a 0–100 percentage-point scale.
    """
    model_config = ConfigDict(extra="allow")

    link: str = Field(..., description="Human-readable link identifier, e.g. 'R1-R2'")
    link_index: Optional[int] = Field(None, description="Numeric link ID from the dataset (1–30)")
    capacity_kbps: Optional[float] = Field(None, description="Maximum link capacity in kbps")
    traffic_kbps: Optional[float] = Field(None, description="Current traffic volume in kbps")

    # Context window — all in percentage-points (0–100)
    utilization_pct: float = Field(..., description="Current utilization % (0–100 scale)")
    util_lag_1: float = Field(..., description="Utilization 5 min ago (%)")
    util_lag_2: float = Field(..., description="Utilization 10 min ago (%)")
    util_lag_3: float = Field(..., description="Utilization 15 min ago (%)")
    util_lag_4: float = Field(..., description="Utilization 20 min ago (%)")
    util_lag_5: float = Field(..., description="Utilization 25 min ago (%)")

    # Optional rolling statistics (calculated automatically if omitted)
    util_mean_3: Optional[float] = Field(None, description="Mean utilization over last 3 steps (%)")
    util_std_3: Optional[float] = Field(None, description="Std dev of utilization over last 3 steps (%)")
    util_trend_3: Optional[float] = Field(None, description="Trend (slope) of utilization over last 3 steps (%)")

    # Optional extended context (>= 2 observations)
    history: Optional[List[float]] = Field(None, description="Optional per-link telemetry history buffer")
    timestamp: Optional[str] = Field("", description="ISO timestamp of the current observation")

    @field_validator("utilization_pct", "util_lag_1", "util_lag_2", "util_lag_3", "util_lag_4", "util_lag_5")
    @classmethod
    def validate_utilization_bounds(cls, v: float, info) -> float:
        if math.isnan(v) or math.isinf(v):
            raise ValueError(f"Field '{info.field_name}' must be finite, got {v}")
        if v < 0.0 or v > 100.0:
            raise ValueError(
                f"Field '{info.field_name}'={v}% outside physically valid range [0, 100]%"
            )
        return float(v)


class RoutingCostRequest(BaseModel):
    """
    Input schema for routing cost conversion.
    predicted_utilization_percent: float on 0–100 scale
    current_metrics: dict that must include 'link' key
    """
    model_config = ConfigDict(extra="allow")

    predicted_utilization_percent: float = Field(
        ..., description="Predicted utilization in percentage-points (0–100)"
    )
    current_metrics: Dict[str, Any] = Field(
        ..., description="Dict with at least 'link' key identifying the link"
    )

    @field_validator("predicted_utilization_percent")
    @classmethod
    def validate_predicted_pct(cls, v: float) -> float:
        if math.isnan(v) or math.isinf(v):
            raise ValueError(f"predicted_utilization_percent must be finite, got {v}")
        return float(v)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health", summary="Predictor health check")
def health_check():
    """
    Returns the predictor availability status.

    status values:
      - 'healthy'       → Chronos-2 model is loaded and ready for inference
      - 'model_missing' → Model failed to load (offline or uninitialized)
    """
    if predictor is not None:
        return {
            "status": "healthy",
            "model": predictor.model_id,
            "device": predictor.device,
        }
    return {
        "status": "model_missing",
        "model": DEFAULT_MODEL_ID,
        "error": _startup_error or "Model not loaded",
    }


def _moving_average_fallback(sample: Dict[str, Any], threshold: float) -> Dict[str, Any]:
    """Compute moving average fallback forecast if neural model is unavailable."""
    # Try util_mean_3, or average of last 3 lags + current
    lags = [
        sample.get("util_lag_2", 0.0),
        sample.get("util_lag_1", 0.0),
        sample.get("utilization_pct", 0.0),
    ]
    ma = float(sample.get("util_mean_3", sum(lags) / len(lags)))
    pred_pct = min(100.0, max(0.0, ma))
    risk = "HIGH" if pred_pct > threshold else "LOW"
    current_pct = float(sample.get("utilization_pct", 0.0))

    return {
        "link": sample.get("link", "UNKNOWN"),
        "timestamp": sample.get("timestamp", ""),
        "model": "Moving Average (fallback)",
        "prediction_horizon_minutes": 5,
        "current_utilization": current_pct / 100.0,
        "predicted_utilization": pred_pct / 100.0,
        "predicted_utilization_percent": pred_pct,
        "congestion_risk": risk,
        "status": "ok",
    }


@app.post("/predict", summary="Predict next-5-minute link utilization")
def predict(request: PredictionRequest, allow_fallback: bool = Query(False)):
    """
    Zero-shot forecast of the next 5-minute link utilization using amazon/chronos-2.

    Returns predicted_utilization_percent on a 0–100 percentage-point scale,
    plus fractional current_utilization and predicted_utilization (0–1) for
    downstream compatibility with Ritu's routing engine and Daksh's controller.
    """
    sample = request.model_dump()

    if predictor is None:
        if allow_fallback:
            cfg = load_config()
            thresh = float(cfg.get("congestion", {}).get("high_threshold", 50.0))
            return _moving_average_fallback(sample, thresh)

        raise HTTPException(
            status_code=503,
            detail=f"Predictor not available. Error: {_startup_error or 'Model not initialized'}",
        )

    try:
        result = predictor.predict(sample)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Prediction error: {exc}")


@app.post("/predict/batch", summary="Batch link utilization forecast")
def predict_batch(requests: List[PredictionRequest], allow_fallback: bool = Query(False)):
    """
    Predict utilization for multiple links concurrently using true model batching.
    Invalid items are captured with an 'error' status in their respective response
    slot without failing the remainder of the batch.
    """
    if not requests:
        return []

    samples = [req.model_dump() for req in requests]

    if predictor is None:
        if allow_fallback:
            cfg = load_config()
            thresh = float(cfg.get("congestion", {}).get("high_threshold", 50.0))
            return [_moving_average_fallback(s, thresh) for s in samples]

        raise HTTPException(
            status_code=503,
            detail=f"Predictor not available. Error: {_startup_error or 'Model not initialized'}",
        )

    try:
        results = predictor.predict_batch(samples)
        return results
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Batch execution error: {exc}")


@app.get("/model-info", summary="Configured model information")
def model_info():
    """
    Returns information regarding the configured prediction engine, thresholds,
    context lengths, and benchmark reference figures.
    """
    config = load_config()
    high_threshold = config.get("congestion", {}).get("high_threshold", 50.0)
    model_cfg = config.get("model", {})
    cost_cfg = config.get("routing_cost", {})

    active_model = predictor.model_id if predictor is not None else model_cfg.get("model_id", DEFAULT_MODEL_ID)

    return {
        "primary_model": active_model,
        "model_type": "zero-shot pretrained foundation model (Chronos-2)",
        "source": "HuggingFace Hub (amazon/chronos-2) — zero-shot, no task fine-tuning",
        "fallback_model": "Moving Average (util_mean_3)",
        "prediction_horizon_minutes": int(model_cfg.get("prediction_horizon_minutes", 5)),
        "context_window_steps": int(model_cfg.get("context_length", 6)),
        "congestion_high_threshold_pct": float(high_threshold),
        "utilization_scale": "0–100 percentage-points",
        "routing_cost_formula": "cost = base_cost + (predicted_utilization_percent / cost_factor) + (penalty if > threshold)",
        "routing_cost_parameters": {
            "base_cost": float(cost_cfg.get("base_cost", 1.0)),
            "cost_factor": float(cost_cfg.get("cost_factor", 10.0)),
            "penalty": float(cost_cfg.get("penalty", 100.0)),
        },
        "benchmark_validation_mae": {
            "Moving Average": 0.1772,
            "chronos-2 univariate (zero-shot)": 0.1788,
            "chronos-2 + past_covariates (zero-shot)": 0.1805,
            "Persistence": 0.1804,
            "chronos-t5-tiny (zero-shot)": 0.1820,
        },
        "model_loaded": predictor is not None,
    }


@app.post("/routing-cost", summary="Convert predicted utilization to routing cost")
def get_routing_cost(request: RoutingCostRequest):
    """
    Converts a predicted utilization percentage into a numeric routing cost
    that Ritu's Dijkstra engine can consume.

    Returns:
        link                         : link identifier
        predicted_utilization        : fractional form (0.0–1.0)
        predicted_utilization_percent: percentage-point form (0.0–100.0)
        predicted_cost               : non-negative routing cost (float)
        risk                         : 'LOW' or 'HIGH'
    """
    try:
        cost = prediction_to_routing_cost(
            request.predicted_utilization_percent,
            request.current_metrics,
        )
        return cost
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Cost calculation error: {exc}")
