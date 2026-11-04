"""
routing_cost.py
===============
Converts predicted link utilization into a non-negative routing cost
that Ritu's Dijkstra routing engine can consume.

Architecture Boundary:
----------------------
This module defines a heuristic cost function based on link utilization forecasts.
It does NOT select paths, run Dijkstra, or modify network configurations.

Formula:
--------
    base_cost = 1.0
    cost = base_cost + (predicted_utilization_pct / 10.0)
    if predicted_utilization_pct > high_threshold (default 50.0%):
        cost += 100.0 (configurable penalty)
"""

import math
import os
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional, Union
import yaml

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config" / "config.yaml"


@lru_cache(maxsize=1)
def load_config(config_file: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from YAML. Cached in memory so it is not re-read
    from disk on every single link prediction.
    """
    target = Path(config_file) if config_file else CONFIG_PATH
    if not target.exists():
        return {
            "congestion": {"high_threshold": 50.0},
            "routing_cost": {
                "base_cost": 1.0,
                "cost_factor": 10.0,
                "penalty": 100.0,
            },
        }
    with open(target, "r", encoding="utf-8") as f:
        cfg = yaml.safe_load(f) or {}
    return cfg


def clear_config_cache():
    """Clear cached configuration (useful during tests or live config reload)."""
    load_config.cache_clear()


def prediction_to_routing_cost(
    predicted_utilization_pct: Union[float, int],
    current_metrics: Optional[Dict[str, Any]] = None,
    config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Converts predicted utilization (0–100% scale) into a Dijkstra routing cost.

    Parameters
    ----------
    predicted_utilization_pct : float or int
        Forecasted utilization percentage (0.0 to 100.0 scale).
        Must be a finite numeric value.
    current_metrics : dict, optional
        Dictionary describing current link telemetry. Must contain 'link' key,
        e.g., {"link": "R1-R2"}. If omitted or missing 'link', defaults to "UNKNOWN".
    config : dict, optional
        Optional pre-loaded configuration dict. If None, uses cached load_config().

    Returns
    -------
    dict
        - "link": str identifier
        - "predicted_utilization": fractional form (0.0 – 1.0)
        - "predicted_utilization_percent": percentage-point form (0.0 – 100.0)
        - "predicted_cost": float >= 1.0 (finite, non-negative)
        - "risk": "LOW" or "HIGH"

    Raises
    ------
    ValueError: If predicted_utilization_pct is NaN, infinite, or non-numeric.
    """
    # 1. Validate numeric input
    try:
        val = float(predicted_utilization_pct)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"predicted_utilization_pct must be a valid number, got {predicted_utilization_pct!r}"
        ) from exc

    if math.isnan(val) or math.isinf(val):
        raise ValueError(
            f"predicted_utilization_pct must be finite, got {val}"
        )

    # 2. Safely clamp to physically valid percentage-point range [0.0, 100.0]
    clamped_pct = min(100.0, max(0.0, val))

    # 3. Retrieve policy configuration parameters
    cfg = config if config is not None else load_config()
    high_threshold = float(cfg.get("congestion", {}).get("high_threshold", 50.0))
    cost_cfg = cfg.get("routing_cost", {})
    base_cost = float(cost_cfg.get("base_cost", 1.0))
    cost_factor = float(cost_cfg.get("cost_factor", 10.0))
    penalty = float(cost_cfg.get("penalty", 100.0))

    if cost_factor <= 0:
        cost_factor = 10.0

    # 4. Compute cost
    # Base cost + proportional utilization term
    cost = base_cost + (clamped_pct / cost_factor)

    # Threshold boundary rule: strictly greater than high_threshold triggers penalty
    if clamped_pct > high_threshold:
        risk = "HIGH"
        cost += penalty
    else:
        risk = "LOW"

    # 5. Extract link identifier safely
    link_id = "UNKNOWN"
    if isinstance(current_metrics, dict):
        raw_link = current_metrics.get("link")
        if raw_link is not None:
            link_id = str(raw_link).strip() or "UNKNOWN"

    return {
        "link": link_id,
        "predicted_utilization": clamped_pct / 100.0,
        "predicted_utilization_percent": clamped_pct,
        "predicted_cost": float(cost),
        "risk": risk,
    }
