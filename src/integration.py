"""
integration.py
==============
High-level interface for integrating the Prediction & ML Layer with:
1. Daksh's network monitoring controller (telemetry provider).
2. Ritu's Dijkstra routing engine (cost consumer).

Integration Patterns Supported:
------------------------------
Pattern A: In-Process Python API (Fastest, zero HTTP serialization overhead)
    from src.integration import LinkConditionPipeline
    pipeline = LinkConditionPipeline()
    link_costs = pipeline.process_telemetry_batch(telemetry_records)

Pattern B: HTTP REST Service (Decoupled microservice architecture)
    POST /predict/batch  -> Returns predicted utilizations and risk
    POST /routing-cost   -> Returns computed Dijkstra edge weights
"""

from typing import Any, Dict, List, Optional
from src.predictor import LinkUtilizationPredictor
from src.routing_cost import prediction_to_routing_cost, load_config


class LinkConditionPipeline:
    """
    Unified pipeline bridging telemetry collection, neural forecasting,
    and routing cost generation in a single in-process interface.
    """

    def __init__(self, predictor: Optional[LinkUtilizationPredictor] = None):
        self.predictor = predictor or LinkUtilizationPredictor.load()
        self.config = load_config()

    def process_single_link(self, telemetry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process a single link's telemetry:
        1. Predict next-5-min utilization using Chronos-2.
        2. Compute Dijkstra routing cost.
        3. Return unified routing payload.

        Parameters
        ----------
        telemetry : dict
            Must contain 6 lag points (or 'history' list), 'link', 'capacity_kbps'.

        Returns
        -------
        dict containing:
            - link: str
            - timestamp: str
            - model: str
            - current_utilization_pct: float (0–100%)
            - predicted_utilization_pct: float (0–100%)
            - predicted_cost: float (>= 1.0)
            - congestion_risk: 'LOW' | 'HIGH'
            - status: 'ok' | 'error'
        """
        pred = self.predictor.predict(telemetry)
        cost_info = prediction_to_routing_cost(
            predicted_utilization_pct=pred["predicted_utilization_percent"],
            current_metrics=telemetry,
            config=self.config,
        )

        return {
            "link": pred["link"],
            "timestamp": pred["timestamp"],
            "model": pred["model"],
            "prediction_horizon_minutes": pred["prediction_horizon_minutes"],
            "current_utilization_fraction": pred["current_utilization"],
            "current_utilization_pct": pred["current_utilization"] * 100.0,
            "predicted_utilization_fraction": pred["predicted_utilization"],
            "predicted_utilization_pct": pred["predicted_utilization_percent"],
            "congestion_risk": pred["congestion_risk"],
            "predicted_cost": cost_info["predicted_cost"],
            "status": "ok",
        }

    def process_telemetry_batch(self, telemetry_records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Process multiple link telemetry records concurrently using true batching.

        Parameters
        ----------
        telemetry_records : list of dicts

        Returns
        -------
        list of dicts, preserving exact input order.
        """
        if not telemetry_records:
            return []

        # 1. Run batched forecast
        predictions = self.predictor.predict_batch(telemetry_records)

        # 2. Map predictions to routing costs
        outputs = []
        for i, pred in enumerate(predictions):
            telemetry = telemetry_records[i]
            if pred.get("status") == "error":
                outputs.append({
                    "link": pred.get("link", "UNKNOWN"),
                    "status": "error",
                    "error": pred.get("error", "Unknown prediction error"),
                    "predicted_cost": float(self.config.get("routing_cost", {}).get("penalty", 100.0)) + 1.0,
                    "congestion_risk": "HIGH",
                })
                continue

            cost_info = prediction_to_routing_cost(
                predicted_utilization_pct=pred["predicted_utilization_percent"],
                current_metrics=telemetry,
                config=self.config,
            )

            outputs.append({
                "link": pred["link"],
                "timestamp": pred["timestamp"],
                "model": pred["model"],
                "prediction_horizon_minutes": pred["prediction_horizon_minutes"],
                "current_utilization_fraction": pred["current_utilization"],
                "current_utilization_pct": pred["current_utilization"] * 100.0,
                "predicted_utilization_fraction": pred["predicted_utilization"],
                "predicted_utilization_pct": pred["predicted_utilization_percent"],
                "congestion_risk": pred["congestion_risk"],
                "predicted_cost": cost_info["predicted_cost"],
                "status": "ok",
            })

        return outputs

