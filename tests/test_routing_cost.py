"""
tests/test_routing_cost.py
==========================
Unit tests for the routing cost conversion layer.
No external dependencies required (no model weights, no dataset).
"""

import math
import pytest
from src.routing_cost import prediction_to_routing_cost, load_config


# ── load_config ────────────────────────────────────────────────────────────────

class TestLoadConfig:
    def test_returns_dict(self):
        cfg = load_config()
        assert isinstance(cfg, dict)

    def test_has_congestion_key(self):
        cfg = load_config()
        assert "congestion" in cfg

    def test_threshold_is_positive(self):
        cfg = load_config()
        threshold = cfg["congestion"].get("high_threshold", 50.0)
        assert threshold > 0


# ── prediction_to_routing_cost ─────────────────────────────────────────────────

class TestPredictionToRoutingCost:

    METRICS = {"link": "R1-R2", "utilization_pct": 30.0}

    def _cost(self, pct, metrics=None):
        return prediction_to_routing_cost(pct, metrics or self.METRICS)

    # --- required output fields ---

    def test_has_link_key(self):
        result = self._cost(20.0)
        assert "link" in result

    def test_has_predicted_utilization_pct(self):
        result = self._cost(20.0)
        assert "predicted_utilization_percent" in result

    def test_has_predicted_utilization_fraction(self):
        result = self._cost(20.0)
        assert "predicted_utilization" in result

    def test_has_predicted_cost(self):
        result = self._cost(20.0)
        assert "predicted_cost" in result

    def test_has_risk(self):
        result = self._cost(20.0)
        assert "risk" in result

    # --- link identifier propagation ---

    def test_link_preserved(self):
        result = self._cost(20.0, {"link": "ATLA-WASH"})
        assert result["link"] == "ATLA-WASH"

    def test_link_unknown_fallback(self):
        result = prediction_to_routing_cost(20.0, {})
        assert result["link"] == "UNKNOWN"

    # --- numeric correctness ---

    def test_cost_is_finite(self):
        result = self._cost(20.0)
        assert math.isfinite(result["predicted_cost"])

    def test_cost_is_non_negative(self):
        for pct in [0.0, 1.0, 20.0, 50.0, 75.0, 100.0]:
            result = self._cost(pct)
            assert result["predicted_cost"] >= 0.0, f"Negative cost at {pct}%"

    def test_fractional_field_is_pct_divided_by_100(self):
        result = self._cost(40.0)
        assert abs(result["predicted_utilization"] - 0.40) < 1e-9

    def test_percent_field_matches_input(self):
        result = self._cost(37.5)
        assert result["predicted_utilization_percent"] == pytest.approx(37.5)

    # --- risk classification ---

    def test_low_risk_below_threshold(self):
        result = self._cost(10.0)
        assert result["risk"] == "LOW"

    def test_high_risk_above_threshold(self):
        # Default threshold from config.yaml is 50.0
        result = self._cost(75.0)
        assert result["risk"] == "HIGH"

    def test_high_risk_triggers_penalty(self):
        low  = self._cost(10.0)["predicted_cost"]
        high = self._cost(75.0)["predicted_cost"]
        assert high > low + 50, "HIGH risk should incur a large cost penalty"

    def test_cost_increases_with_utilization(self):
        """Cost should be monotonically non-decreasing with utilization
        within the same risk band."""
        pcts = [1.0, 5.0, 10.0, 20.0, 30.0, 45.0]
        costs = [self._cost(p)["predicted_cost"] for p in pcts]
        for i in range(len(costs) - 1):
            assert costs[i] <= costs[i + 1], (
                f"Cost decreased from {pcts[i]}% to {pcts[i+1]}%"
            )
