"""
tests/test_smoke_real_model.py
==============================
End-to-end smoke test using the actual amazon/chronos-2 foundation model.

This test is SKIPPED automatically when:
  - The chronos package is not installed
  - Model weights are unavailable (offline environment or HuggingFace unreachable)
  - The environment variable SKIP_REAL_MODEL_TESTS=1 is set

Manual execution:
    python -m pytest tests/test_smoke_real_model.py -v -s

DO NOT treat mocked tests as proof that real neural inference functions.
This smoke test provides that verification against real weights.
"""

import math
import os
import pytest


# ── Skip conditions ────────────────────────────────────────────────────────────

def _chronos_available() -> bool:
    try:
        from chronos import Chronos2Pipeline  # noqa: F401
        return True
    except ImportError:
        return False


skip_if_no_chronos = pytest.mark.skipif(
    not _chronos_available() or os.getenv("SKIP_REAL_MODEL_TESTS") == "1",
    reason="chronos-forecasting not installed or SKIP_REAL_MODEL_TESTS=1",
)


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def real_sample():
    """Load one real sample from the test dataset. Skip if dataset missing."""
    try:
        from src.data_loader import load_data
        test_df = load_data("test", nrows=5)
    except Exception as exc:
        pytest.skip(f"Dataset not available: {exc}")

    row = test_df.iloc[0]
    sample = row.to_dict()
    sample["link"] = f"{row.get('src', 'R1')}-{row.get('dst', 'R2')}"
    return sample


@pytest.fixture(scope="module")
def real_predictor():
    """Load the real Chronos-2 predictor. Skip if model weights unavailable."""
    try:
        from src.predictor import LinkUtilizationPredictor
        return LinkUtilizationPredictor.load()
    except Exception as exc:
        pytest.skip(f"Chronos-2 model weights unavailable: {exc}")


# ── Smoke tests ────────────────────────────────────────────────────────────────

@skip_if_no_chronos
class TestRealChronosSmoke:

    def test_prediction_returns_dict(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        assert isinstance(result, dict)

    def test_all_required_fields_present(self, real_predictor, real_sample):
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
        result = real_predictor.predict(real_sample)
        assert required.issubset(result.keys())

    def test_prediction_is_finite(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        assert math.isfinite(result["predicted_utilization_percent"])

    def test_prediction_is_within_bounds(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        assert 0.0 <= result["predicted_utilization_percent"] <= 100.0

    def test_fractional_consistent_with_percent(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        expected = result["predicted_utilization_percent"] / 100.0
        assert abs(result["predicted_utilization"] - expected) < 1e-9

    def test_risk_is_valid_label(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        assert result["congestion_risk"] in ("LOW", "HIGH")

    def test_model_is_chronos2(self, real_predictor, real_sample):
        result = real_predictor.predict(real_sample)
        assert result["model"] == "amazon/chronos-2"

    def test_real_batch_prediction(self, real_predictor, real_sample):
        results = real_predictor.predict_batch([real_sample, real_sample])
        assert len(results) == 2
        assert results[0]["link"] == real_sample["link"]
        assert results[1]["link"] == real_sample["link"]
        assert results[0]["status"] == "ok"
        assert results[1]["status"] == "ok"

    def test_end_to_end_with_routing_cost(self, real_predictor, real_sample):
        from src.routing_cost import prediction_to_routing_cost

        pred = real_predictor.predict(real_sample)
        cost = prediction_to_routing_cost(pred["predicted_utilization_percent"], pred)

        assert cost["link"] == pred["link"]
        assert math.isfinite(cost["predicted_cost"])
        assert cost["predicted_cost"] >= 1.0
        assert abs(
            cost["predicted_utilization"]
            - cost["predicted_utilization_percent"] / 100.0
        ) < 1e-9

        print(
            f"\n[REAL SMOKE VERIFIED] Link={pred['link']} | "
            f"Current={pred['current_utilization']*100:.2f}% | "
            f"Predicted={pred['predicted_utilization_percent']:.2f}% | "
            f"Risk={pred['congestion_risk']} | Cost={cost['predicted_cost']:.2f}"
        )
