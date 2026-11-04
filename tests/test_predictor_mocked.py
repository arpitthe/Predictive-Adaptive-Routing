"""
tests/test_predictor_mocked.py
==============================
Unit tests for the LinkUtilizationPredictor using a mocked Chronos-2 pipeline.

All tests run fully offline with zero model downloads or network access.
Mocks Chronos2Pipeline with a deterministic stub to verify context validation,
boundary checks, batch inference, error isolation, and schema contracts.
"""

import math
from unittest.mock import MagicMock, patch
import numpy as np
import pytest
import torch


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_mock_pipeline(median_value: float = 25.0):
    """
    Create a mock Chronos2Pipeline that returns `median_value` for each input.
    Supports variable-length batch sizes.
    """
    mock_pipeline = MagicMock()

    def _predict(inputs, prediction_length=1, batch_size=1):
        forecasts = []
        for _ in inputs:
            tensor = torch.zeros(1, 21, 1)
            tensor[0, 10, 0] = median_value
            forecasts.append(tensor)
        return forecasts

    mock_pipeline.predict.side_effect = _predict
    return mock_pipeline


def _make_sample(utilization_pct: float = 30.0) -> dict:
    return {
        "link": "R1-R2",
        "link_index": 1,
        "capacity_kbps": 9920000.0,
        "traffic_kbps": 2976000.0,
        "utilization_pct": utilization_pct,
        "util_lag_1": utilization_pct - 1,
        "util_lag_2": utilization_pct - 2,
        "util_lag_3": utilization_pct - 3,
        "util_lag_4": utilization_pct - 4,
        "util_lag_5": utilization_pct - 5,
        "util_mean_3": utilization_pct - 1.5,
        "util_std_3": 1.0,
        "util_trend_3": 1.0,
        "timestamp": "2004-09-01 12:00:00",
    }


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestPredictorMocked:
    """Offline unit tests with mocked Chronos-2 pipeline."""

    @pytest.fixture(autouse=True)
    def mock_chronos(self):
        mock_pipe = _make_mock_pipeline(median_value=25.0)
        with patch(
            "src.predictor.Chronos2Pipeline.from_pretrained",
            return_value=mock_pipe,
        ):
            yield mock_pipe

    def _get_predictor(self):
        from src.predictor import LinkUtilizationPredictor
        return LinkUtilizationPredictor.load()

    # --- Schema & Required Fields ---

    def test_predict_returns_dict(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert isinstance(result, dict)

    def test_all_required_fields_present(self):
        required = {
            "link",
            "timestamp",
            "model",
            "prediction_horizon_minutes",
            "current_utilization",
            "predicted_utilization",
            "predicted_utilization_percent",
            "congestion_risk",
            "status",
        }
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert required.issubset(result.keys()), f"Missing fields: {required - result.keys()}"

    # --- Numeric validity & Unit scaling ---

    def test_predicted_utilization_percent_is_finite(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert math.isfinite(result["predicted_utilization_percent"])

    def test_predicted_utilization_percent_is_non_negative(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert result["predicted_utilization_percent"] >= 0.0

    def test_fractional_equals_pct_over_100(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        expected_frac = result["predicted_utilization_percent"] / 100.0
        assert abs(result["predicted_utilization"] - expected_frac) < 1e-9

    def test_current_utilization_is_input_pct_over_100(self):
        p = self._get_predictor()
        result = p.predict(_make_sample(utilization_pct=40.0))
        assert abs(result["current_utilization"] - 0.40) < 1e-9

    # --- Metadata & Link identity ---

    def test_link_propagated(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["link"] = "ATLA-WASH"
        result = p.predict(sample)
        assert result["link"] == "ATLA-WASH"

    def test_model_field_is_chronos2(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert result["model"] == "amazon/chronos-2"

    def test_horizon_is_5(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert result["prediction_horizon_minutes"] == 5

    # --- Risk classification ---

    def test_low_risk_when_below_threshold(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert result["congestion_risk"] == "LOW"

    def test_high_risk_when_above_threshold(self):
        mock_pipe = _make_mock_pipeline(median_value=75.0)
        with patch(
            "src.predictor.Chronos2Pipeline.from_pretrained",
            return_value=mock_pipe,
        ):
            p = self._get_predictor()
            result = p.predict(_make_sample())
            assert result["congestion_risk"] == "HIGH"

    # --- Input Validation & Edge Cases ---

    def test_missing_lag_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        del sample["util_lag_3"]
        with pytest.raises(ValueError, match="util_lag_3"):
            p.predict(sample)

    def test_nan_in_lag_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["util_lag_2"] = float("nan")
        with pytest.raises(ValueError, match="finite"):
            p.predict(sample)

    def test_inf_in_lag_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["util_lag_1"] = float("inf")
        with pytest.raises(ValueError, match="finite"):
            p.predict(sample)

    def test_negative_utilization_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["utilization_pct"] = -5.0
        with pytest.raises(ValueError, match="outside physically valid range"):
            p.predict(sample)

    def test_utilization_above_100_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["utilization_pct"] = 105.0
        with pytest.raises(ValueError, match="outside physically valid range"):
            p.predict(sample)

    def test_invalid_capacity_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        sample["capacity_kbps"] = -100.0
        with pytest.raises(ValueError, match="capacity_kbps"):
            p.predict(sample)

    # --- Configurable Context Window (History list) ---

    def test_custom_history_sequence_accepted(self):
        p = self._get_predictor()
        sample = {
            "link": "R1-R2",
            "history": [10.0, 12.0, 15.0, 18.0, 20.0, 22.0, 25.0, 28.0],
            "timestamp": "2004-09-01 12:00:00",
        }
        result = p.predict(sample)
        assert result["status"] == "ok"
        assert result["current_utilization"] == 0.28

    def test_short_history_sequence_rejected(self):
        p = self._get_predictor()
        sample = {
            "link": "R1-R2",
            "history": [10.0],  # < 2 points
        }
        with pytest.raises(ValueError, match="at least 2 points"):
            p.predict(sample)

    # --- True Batch Inference & Error Isolation ---

    def test_batch_prediction_preserves_order(self):
        p = self._get_predictor()
        s1 = _make_sample(utilization_pct=10.0)
        s1["link"] = "LINK-A"
        s2 = _make_sample(utilization_pct=20.0)
        s2["link"] = "LINK-B"
        s3 = _make_sample(utilization_pct=30.0)
        s3["link"] = "LINK-C"

        batch_results = p.predict_batch([s1, s2, s3])
        assert len(batch_results) == 3
        assert batch_results[0]["link"] == "LINK-A"
        assert batch_results[1]["link"] == "LINK-B"
        assert batch_results[2]["link"] == "LINK-C"
        for res in batch_results:
            assert res["status"] == "ok"

    def test_batch_error_isolation(self):
        p = self._get_predictor()
        s_valid1 = _make_sample(utilization_pct=10.0)
        s_valid1["link"] = "LINK-1"

        s_bad = _make_sample(utilization_pct=-99.0)  # Invalid negative
        s_bad["link"] = "LINK-BAD"

        s_valid2 = _make_sample(utilization_pct=20.0)
        s_valid2["link"] = "LINK-2"

        batch_results = p.predict_batch([s_valid1, s_bad, s_valid2])
        assert len(batch_results) == 3

        # Item 0 succeeded
        assert batch_results[0]["status"] == "ok"
        assert batch_results[0]["link"] == "LINK-1"

        # Item 1 isolated error
        assert batch_results[1]["status"] == "error"
        assert batch_results[1]["link"] == "LINK-BAD"
        assert "error" in batch_results[1]

        # Item 2 succeeded
        assert batch_results[2]["status"] == "ok"
        assert batch_results[2]["link"] == "LINK-2"

    # --- End-to-End Pipeline ---

    def test_end_to_end_pipeline_produces_valid_cost(self):
        from src.routing_cost import prediction_to_routing_cost
        p = self._get_predictor()
        pred = p.predict(_make_sample(utilization_pct=30.0))

        cost = prediction_to_routing_cost(pred["predicted_utilization_percent"], pred)

        assert cost["link"] == pred["link"]
        assert math.isfinite(cost["predicted_cost"])
        assert cost["predicted_cost"] >= 1.0
        assert cost["risk"] in ("LOW", "HIGH")
