"""
tests/test_routing_cost.py
==========================
Unit tests for the routing cost conversion engine.
Tests boundary conditions, numerical safety, error handling, and monotonic cost.
No model weights or dataset downloads required.
"""

import math
import pytest
from src.routing_cost import prediction_to_routing_cost, load_config, clear_config_cache


# ── Configuration tests ────────────────────────────────────────────────────────

class TestLoadConfig:
    def test_returns_dict(self):
        clear_config_cache()
        cfg = load_config()
        assert isinstance(cfg, dict)

    def test_has_congestion_and_routing_cost_keys(self):
        cfg = load_config()
        assert "congestion" in cfg
        assert "high_threshold" in cfg["congestion"]

    def test_threshold_is_positive(self):
        cfg = load_config()
        threshold = cfg["congestion"].get("high_threshold", 50.0)
        assert threshold > 0.0


# ── Routing cost conversion tests ──────────────────────────────────────────────

class TestPredictionToRoutingCost:
    METRICS = {"link": "R1-R2", "utilization_pct": 30.0}

    def _cost(self, pct, metrics=None, config=None):
        return prediction_to_routing_cost(pct, metrics or self.METRICS, config=config)

    # --- required output schema ---

    def test_has_all_required_keys(self):
        result = self._cost(20.0)
        required_keys = {
            "link",
            "predicted_utilization",
            "predicted_utilization_percent",
            "predicted_cost",
            "risk",
        }
        assert required_keys.issubset(result.keys())

    # --- link identifier propagation & fallbacks ---

    def test_link_preserved(self):
        result = self._cost(20.0, {"link": "ATLA-WASH"})
        assert result["link"] == "ATLA-WASH"

    def test_link_missing_or_empty_fallback(self):
        assert self._cost(20.0, {})["link"] == "UNKNOWN"
        assert self._cost(20.0, None)["link"] == "UNKNOWN"
        assert self._cost(20.0, {"link": ""})["link"] == "UNKNOWN"
        assert self._cost(20.0, {"link": "   "})["link"] == "UNKNOWN"

    # --- numerical validity & unit correctness ---

    def test_cost_is_finite(self):
        for pct in [0.0, 0.0597, 25.0, 50.0, 50.01, 75.0, 100.0]:
            result = self._cost(pct)
            assert math.isfinite(result["predicted_cost"])

    def test_cost_is_strictly_positive(self):
        for pct in [0.0, 1.0, 20.0, 50.0, 75.0, 100.0]:
            result = self._cost(pct)
            assert result["predicted_cost"] >= 1.0, f"Cost below base_cost at {pct}%"

    def test_fractional_field_equals_pct_divided_by_100(self):
        result = self._cost(40.0)
        assert abs(result["predicted_utilization"] - 0.40) < 1e-9

    def test_percent_field_matches_input(self):
        result = self._cost(37.5)
        assert result["predicted_utilization_percent"] == pytest.approx(37.5)

    # --- boundary behavior at exactly 50% vs above 50% ---

    def test_boundary_exactly_at_threshold(self):
        """
        At exactly 50.0%, utilization does NOT exceed the threshold.
        Risk must be LOW.
        Cost = 1.0 (base) + 50.0 / 10.0 = 6.0 (no penalty).
        """
        result = self._cost(50.0)
        assert result["risk"] == "LOW"
        assert result["predicted_cost"] == pytest.approx(6.0)

    def test_boundary_just_above_threshold(self):
        """
        At 50.001%, utilization strictly exceeds 50.0%.
        Risk must be HIGH.
        Cost = 1.0 + 5.0001 + 100.0 (penalty) = 106.0001.
        """
        result = self._cost(50.001)
        assert result["risk"] == "HIGH"
        assert result["predicted_cost"] == pytest.approx(106.0001, rel=1e-5)

    def test_zero_utilization_cost(self):
        """At 0.0% utilization, cost should equal base_cost (1.0)."""
        result = self._cost(0.0)
        assert result["risk"] == "LOW"
        assert result["predicted_cost"] == pytest.approx(1.0)

    def test_full_100_percent_utilization_cost(self):
        """At 100% utilization, cost = 1.0 + 10.0 + 100.0 = 111.0."""
        result = self._cost(100.0)
        assert result["risk"] == "HIGH"
        assert result["predicted_cost"] == pytest.approx(111.0)

    # --- monotonic increase within risk bands ---

    def test_cost_increases_monotonically_low_risk(self):
        low_pcts = [0.0, 5.0, 10.0, 20.0, 35.0, 49.9, 50.0]
        costs = [self._cost(p)["predicted_cost"] for p in low_pcts]
        for i in range(len(costs) - 1):
            assert costs[i] < costs[i + 1]

    def test_cost_increases_monotonically_high_risk(self):
        high_pcts = [50.1, 60.0, 75.0, 90.0, 100.0]
        costs = [self._cost(p)["predicted_cost"] for p in high_pcts]
        for i in range(len(costs) - 1):
            assert costs[i] < costs[i + 1]

    # --- safe clamping of out-of-range valid floats ---

    def test_negative_utilization_clamped(self):
        result = self._cost(-10.0)
        assert result["predicted_utilization_percent"] == 0.0
        assert result["predicted_cost"] == pytest.approx(1.0)
        assert result["risk"] == "LOW"

    def test_greater_than_100_utilization_clamped(self):
        result = self._cost(150.0)
        assert result["predicted_utilization_percent"] == 100.0
        assert result["predicted_cost"] == pytest.approx(111.0)
        assert result["risk"] == "HIGH"

    # --- invalid non-numeric and non-finite inputs ---

    def test_nan_raises_value_error(self):
        with pytest.raises(ValueError, match="finite"):
            self._cost(float("nan"))

    def test_inf_raises_value_error(self):
        with pytest.raises(ValueError, match="finite"):
            self._cost(float("inf"))

    def test_neg_inf_raises_value_error(self):
        with pytest.raises(ValueError, match="finite"):
            self._cost(float("-inf"))

    def test_string_non_numeric_raises_value_error(self):
        with pytest.raises(ValueError, match="valid number"):
            self._cost("not-a-number")
