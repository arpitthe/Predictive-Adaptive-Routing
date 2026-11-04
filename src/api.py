"""
api.py
======
FastAPI service for the Prediction & Machine Learning Layer.

Endpoints
---------
GET  /health          → predictor availability status
POST /predict         → single-link next-5-min utilization forecast
POST /predict/batch   → batch forecast with per-item error handling
GET  /model-info      → configured model details (Chronos-2, HuggingFace zero-shot)
POST /routing-cost    → convert predicted utilization to Dijkstra routing cost

Unit convention: all utilization fields on the 0–100 percentage-point scale
unless the field name ends in a fraction indicator (e.g. current_utilization
is the fractional form 0–1 for legacy compatibility; predicted_utilization_percent
is the definitive 0–100 field).
"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import List, Dict, Any, Optional

from src.predictor import LinkUtilizationPredictor, MODEL_ID
from src.routing_cost import prediction_to_routing_cost

app = FastAPI(
    title="Prediction & Machine Learning Layer API",
    description=(
        "Predictive AI-Assisted Adaptive Routing — Link Condition Forecast. "
        "Primary model: amazon/chronos-2 (zero-shot, no fine-tuning). "
        "Fallback: Moving Average."
    ),
    version="1.0.0",
)

# Global predictor instance — None until startup succeeds
predictor: Optional[LinkUtilizationPredictor] = None
_startup_error: Optional[str] = None


@app.on_event("startup")
def load_model():
    global predictor, _startup_error
    try:
        predictor = LinkUtilizationPredictor.load()
        print(f"[startup] Predictor loaded: {MODEL_ID}")
    except Exception as exc:
        _startup_error = str(exc)
        print(f"[startup] WARNING: Predictor not loaded — {exc}")


# ── Request / Response schemas ─────────────────────────────────────────────────

class PredictionRequest(BaseModel):
    """
    Required fields for a single-link utilization forecast.

    All utilization values are in percentage-points (0–100 scale).
    Example: utilization_pct=72.0 means the link is at 72% utilization.
    """
    model_config = ConfigDict(extra="allow")

    link: str = Field(..., description="Human-readable link identifier, e.g. 'R1-R2'")
    link_index: int = Field(..., description="Numeric link ID from the dataset (1–30)")
    capacity_kbps: float = Field(..., description="Maximum link capacity in kbps")
    traffic_kbps: float = Field(..., description="Current traffic volume in kbps")

    # Context window — all in percentage-points (0–100)
    utilization_pct: float = Field(..., description="Current utilization % (0–100)")
    util_lag_1: float = Field(..., description="Utilization 5 min ago (%)")
    util_lag_2: float = Field(..., description="Utilization 10 min ago (%)")
    util_lag_3: float = Field(..., description="Utilization 15 min ago (%)")
    util_lag_4: float = Field(..., description="Utilization 20 min ago (%)")
    util_lag_5: float = Field(..., description="Utilization 25 min ago (%)")

    # Rolling statistics — computed from lag columns
    util_mean_3: float = Field(..., description="Mean utilization over last 3 steps (%)")
    util_std_3: float  = Field(..., description="Std dev of utilization over last 3 steps (%)")
    util_trend_3: float = Field(..., description="Trend (slope) of utilization over last 3 steps (%)")

    timestamp: Optional[str] = Field("", description="ISO timestamp of the current observation")


class RoutingCostRequest(BaseModel):
    """
    Input for routing cost conversion.

    predicted_utilization_percent: float on 0–100 scale
    current_metrics: dict that must include 'link' key
    """
    predicted_utilization_percent: float = Field(
        ..., description="Predicted utilization in percentage-points (0–100)"
    )
    current_metrics: Dict[str, Any] = Field(
        ..., description="Dict with at least 'link' key identifying the link"
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@app.get("/health", summary="Predictor health check")
def health_check():
    """
    Returns the predictor availability status.

    status values:
      - "healthy"       → Chronos-2 model is loaded and ready
      - "model_missing" → Model failed to load (weights unavailable or error)
    """
    if predictor is not None:
        return {"status": "healthy", "model": MODEL_ID}
    return {
        "status": "model_missing",
        "model": MODEL_ID,
        "error": _startup_error or "Model not loaded",
    }


@app.post("/predict", summary="Predict next-5-minute link utilization")
def predict(request: PredictionRequest):
    """
    Zero-shot forecast of the next 5-minute link utilization using amazon/chronos-2.

    Returns predicted_utilization_percent on a 0–100 percentage-point scale,
    plus the fractional current_utilization and predicted_utilization (0–1) for
    downstream compatibility.
    """
    if predictor is None:
        raise HTTPException(
            status_code=503,
            detail=f"Predictor not available. Error: {_startup_error or 'unknown'}",
        )
    try:
        sample = request.model_dump()
        result = predictor.predict(sample)
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))


@app.post("/predict/batch", summary="Batch link utilization forecast")
def predict_batch(requests: List[PredictionRequest]):
    """
    Predict utilization for multiple links.
    Invalid items are included in the response with an 'error' key instead of
    raising a 500 for the entire batch.
    """
    if predictor is None:
        raise HTTPException(
            status_code=503,
            detail=f"Predictor not available. Error: {_startup_error or 'unknown'}",
        )

    results = []
    for req in requests:
        sample = req.model_dump()
        try:
            results.append(predictor.predict(sample))
        except Exception as exc:
            results.append({"link": sample.get("link", "UNKNOWN"), "error": str(exc)})

    return results


@app.get("/model-info", summary="Configured model information")
def model_info():
    """
    Returns information about the configured prediction model.

    The primary predictor is amazon/chronos-2, a pretrained zero-shot
    time-series foundation model loaded from HuggingFace. There is no local
    serialised sklearn pipeline for this model — weights are downloaded from
    HuggingFace on first use.
    """
    from pathlib import Path
    import yaml

    config_path = Path(__file__).resolve().parent.parent / "config" / "config.yaml"
    config = {}
    if config_path.exists():
        with open(config_path, "r") as f:
            config = yaml.safe_load(f) or {}

    high_threshold = config.get("congestion", {}).get("high_threshold", 50.0)

    return {
        "primary_model": MODEL_ID,
        "model_type": "zero-shot pretrained foundation model (Chronos-2)",
        "source": "HuggingFace Hub — no local fine-tuning",
        "fallback_model": "Moving Average (util_mean_3)",
        "prediction_horizon_minutes": 5,
        "context_window_steps": 6,
        "congestion_high_threshold_pct": high_threshold,
        "utilization_scale": "0–100 percentage-points",
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

    This is a separate policy layer — it does NOT call the ML predictor.
    Supply the predicted_utilization_percent from the /predict endpoint.

    Returns:
        link                        : link identifier (from current_metrics)
        predicted_utilization       : fractional form (0–1)
        predicted_utilization_percent: percentage-point form (0–100)
        predicted_cost              : non-negative routing cost (float)
        risk                        : 'LOW' or 'HIGH'
    """
    try:
        cost = prediction_to_routing_cost(
            request.predicted_utilization_percent,
            request.current_metrics,
        )
        return cost
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
