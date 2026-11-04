"""
tests/test_predictor_mocked.py
==============================
Unit tests for the predictor interface using a mocked Chronos model.

All tests here run fully offline — no HuggingFace downloads required.
The mock replaces Chronos2Pipeline with a deterministic stub that
returns a fixed median value, letting us test the entire predict()
contract without model weights.
"""

import math
import pytest
from unittest.mock import MagicMock, patch
import torch
import numpy as np


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_mock_pipeline(median_value: float = 25.0):
    """
    Create a mock Chronos2Pipeline that returns `median_value` as the
    median prediction.

    Chronos2Pipeline.predict returns a list of Tensor(n_var=1, n_quantiles=21, pred_len=1).
    Median is at quantile index 10.
    """
    # Build a tensor of shape (1, 21, 1) where index [0, 10, 0] = median_value
    tensor = torch.zeros(1, 21, 1)
    tensor[0, 10, 0] = median_value

    mock_pipeline = MagicMock()
    mock_pipeline.predict.return_value = [tensor]
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
    """Tests run with a mocked Chronos2Pipeline — fully offline."""

    @pytest.fixture(autouse=True)
    def mock_chronos(self):
        """Patch Chronos2Pipeline.from_pretrained to avoid downloads."""
        mock_pipe = _make_mock_pipeline(median_value=25.0)
        with patch(
            "src.predictor.Chronos2Pipeline.from_pretrained",
            return_value=mock_pipe,
        ):
            yield mock_pipe

    def _get_predictor(self):
        from src.predictor import LinkUtilizationPredictor
        return LinkUtilizationPredictor.load()

    # --- output fields ---

    def test_predict_returns_dict(self):
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert isinstance(result, dict)

    def test_all_required_fields_present(self):
        required = {
            "link", "timestamp", "model",
            "prediction_horizon_minutes",
            "current_utilization",
            "predicted_utilization",
            "predicted_utilization_percent",
            "congestion_risk",
        }
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert required.issubset(result.keys()), (
            f"Missing fields: {required - result.keys()}"
        )

    # --- numeric validity ---

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

    # --- link identifier propagation ---

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

    # --- risk classification ---

    def test_low_risk_when_below_threshold(self, mock_chronos):
        """Mock returns 25% → below default threshold of 50% → LOW."""
        p = self._get_predictor()
        result = p.predict(_make_sample())
        assert result["congestion_risk"] == "LOW"

    def test_high_risk_when_above_threshold(self):
        """Mock returns 75% → above default threshold of 50% → HIGH."""
        mock_pipe = _make_mock_pipeline(median_value=75.0)
        with patch(
            "src.predictor.Chronos2Pipeline.from_pretrained",
            return_value=mock_pipe,
        ):
            from src.predictor import LinkUtilizationPredictor
            p = LinkUtilizationPredictor.load()
            result = p.predict(_make_sample())
            assert result["congestion_risk"] == "HIGH"

    # --- missing field handling ---

    def test_missing_lag_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        del sample["util_lag_3"]
        with pytest.raises(ValueError, match="util_lag_3"):
            p.predict(sample)

    def test_missing_utilization_pct_raises_value_error(self):
        p = self._get_predictor()
        sample = _make_sample()
        del sample["utilization_pct"]
        with pytest.raises(ValueError, match="utilization_pct"):
            p.predict(sample)

    # --- end-to-end with routing cost ---

    def test_end_to_end_pipeline_produces_valid_cost(self):
        """Full pipeline: predict → routing cost."""
        from src.routing_cost import prediction_to_routing_cost
        p = self._get_predictor()
        pred = p.predict(_make_sample(utilization_pct=30.0))

        cost = prediction_to_routing_cost(
            pred["predicted_utilization_percent"],
            pred,
        )

        # Link identity preserved through full pipeline
        assert cost["link"] == pred["link"]

        # Cost is numeric, finite, non-negative
        assert isinstance(cost["predicted_cost"], float)
        assert math.isfinite(cost["predicted_cost"])
        assert cost["predicted_cost"] >= 0.0

        # Risk is a valid label
        assert cost["risk"] in ("LOW", "HIGH")

        # Utilization fields are consistent
        assert abs(
            cost["predicted_utilization"] - pred["predicted_utilization_percent"] / 100.0
        ) < 1e-9


class TestPredictorLoadFailure:
    """Verify graceful failure when Chronos2Pipeline cannot load."""

    def test_load_failure_raises_and_does_not_hide(self):
        """Confirm that a failed model load raises an exception — not silently
        returns a dummy predictor."""
        with patch(
            "src.predictor.Chronos2Pipeline.from_pretrained",
            side_effect=RuntimeError("Simulated download failure"),
        ):
            from src.predictor import LinkUtilizationPredictor
            with pytest.raises(RuntimeError, match="Simulated download failure"):
                LinkUtilizationPredictor.load()
