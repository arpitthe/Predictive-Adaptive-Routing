"""
tests/test_api_mocked.py
========================
Lightweight API endpoint tests using FastAPI TestClient and a mocked predictor.
No model weights or dataset downloads required.
"""

import math
import pytest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient


VALID_REQUEST = {
    "link": "R1-R2",
    "link_index": 1,
    "capacity_kbps": 9920000.0,
    "traffic_kbps": 2976000.0,
    "utilization_pct": 30.0,
    "util_lag_1": 29.0,
    "util_lag_2": 28.0,
    "util_lag_3": 27.0,
    "util_lag_4": 26.0,
    "util_lag_5": 25.0,
    "util_mean_3": 28.5,
    "util_std_3": 1.0,
    "util_trend_3": 1.0,
}

EXPECTED_PREDICT_RESPONSE = {
    "link": "R1-R2",
    "timestamp": "",
    "model": "amazon/chronos-2",
    "prediction_horizon_minutes": 5,
    "current_utilization": 0.30,
    "predicted_utilization": 0.25,
    "predicted_utilization_percent": 25.0,
    "congestion_risk": "LOW",
}


def _make_mock_predictor():
    mock = MagicMock()
    mock.predict.return_value = EXPECTED_PREDICT_RESPONSE.copy()
    return mock


@pytest.fixture
def client_with_predictor():
    """TestClient with a mocked predictor injected as the global instance."""
    import src.api as api_module
    mock_pred = _make_mock_predictor()
    
    # Store original state
    orig_predictor = api_module.predictor
    orig_error = api_module._startup_error
    
    with patch("src.api.LinkUtilizationPredictor.load", return_value=mock_pred):
        with TestClient(api_module.app, raise_server_exceptions=True) as client:
            yield client

    # Restore state
    api_module.predictor = orig_predictor
    api_module._startup_error = orig_error


@pytest.fixture
def client_no_predictor():
    """TestClient where the predictor failed to load (None)."""
    import src.api as api_module
    
    # Store original state
    orig_predictor = api_module.predictor
    orig_error = api_module._startup_error
    
    # Force predictor to None so the load failure leaves it as None
    api_module.predictor = None
    
    with patch("src.api.LinkUtilizationPredictor.load", side_effect=RuntimeError("Model weights not available")):
        with TestClient(api_module.app, raise_server_exceptions=False) as client:
            yield client

    # Restore state
    api_module.predictor = orig_predictor
    api_module._startup_error = orig_error


# ── /health ────────────────────────────────────────────────────────────────────

class TestHealthEndpoint:
    def test_healthy_when_predictor_loaded(self, client_with_predictor):
        r = client_with_predictor.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "healthy"
        assert data["model"] == "amazon/chronos-2"

    def test_model_missing_when_predictor_none(self, client_no_predictor):
        r = client_no_predictor.get("/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "model_missing"
        assert "error" in data


# ── /model-info ────────────────────────────────────────────────────────────────

class TestModelInfoEndpoint:
    def test_returns_200(self, client_with_predictor):
        r = client_with_predictor.get("/model-info")
        assert r.status_code == 200

    def test_contains_primary_model(self, client_with_predictor):
        data = client_with_predictor.get("/model-info").json()
        assert data["primary_model"] == "amazon/chronos-2"

    def test_no_final_model_pkl_reference(self, client_with_predictor):
        """model-info must not reference a non-existent pkl file."""
        data = client_with_predictor.get("/model-info").json()
        info_str = str(data)
        assert "final_model.pkl" not in info_str
        assert "pkl" not in info_str.lower()

    def test_contains_benchmark_metrics(self, client_with_predictor):
        data = client_with_predictor.get("/model-info").json()
        assert "benchmark_validation_mae" in data

    def test_threshold_is_positive(self, client_with_predictor):
        data = client_with_predictor.get("/model-info").json()
        assert data["congestion_high_threshold_pct"] > 0


# ── /predict ───────────────────────────────────────────────────────────────────

class TestPredictEndpoint:
    def test_returns_200_with_valid_request(self, client_with_predictor):
        r = client_with_predictor.post("/predict", json=VALID_REQUEST)
        assert r.status_code == 200

    def test_response_has_required_fields(self, client_with_predictor):
        r = client_with_predictor.post("/predict", json=VALID_REQUEST)
        data = r.json()
        required = {
            "link", "model", "prediction_horizon_minutes",
            "current_utilization", "predicted_utilization",
            "predicted_utilization_percent", "congestion_risk",
        }
        assert required.issubset(data.keys())

    def test_503_when_predictor_missing(self, client_no_predictor):
        r = client_no_predictor.post("/predict", json=VALID_REQUEST)
        assert r.status_code == 503

    def test_400_on_value_error(self, client_with_predictor):
        import src.api as api_module
        original_predict = api_module.predictor.predict
        api_module.predictor.predict = MagicMock(side_effect=ValueError("Missing field"))
        r = client_with_predictor.post("/predict", json=VALID_REQUEST)
        assert r.status_code == 400
        api_module.predictor.predict = original_predict

    def test_predicted_utilization_percent_is_non_negative(self, client_with_predictor):
        r = client_with_predictor.post("/predict", json=VALID_REQUEST)
        data = r.json()
        assert data["predicted_utilization_percent"] >= 0.0

    def test_model_name_in_response(self, client_with_predictor):
        r = client_with_predictor.post("/predict", json=VALID_REQUEST)
        assert r.json()["model"] == "amazon/chronos-2"


# ── /predict/batch ─────────────────────────────────────────────────────────────

class TestPredictBatchEndpoint:
    def test_returns_list(self, client_with_predictor):
        r = client_with_predictor.post("/predict/batch", json=[VALID_REQUEST])
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_batch_length_matches_input(self, client_with_predictor):
        r = client_with_predictor.post(
            "/predict/batch", json=[VALID_REQUEST, VALID_REQUEST]
        )
        assert len(r.json()) == 2

    def test_503_when_predictor_missing(self, client_no_predictor):
        r = client_no_predictor.post("/predict/batch", json=[VALID_REQUEST])
        assert r.status_code == 503

    def test_error_items_dont_fail_whole_batch(self, client_with_predictor):
        import src.api as api_module
        original_predict = api_module.predictor.predict
        
        # First call fails, second succeeds
        api_module.predictor.predict = MagicMock(side_effect=[
            ValueError("Bad input"),
            EXPECTED_PREDICT_RESPONSE.copy(),
        ])
        
        r = client_with_predictor.post(
            "/predict/batch", json=[VALID_REQUEST, VALID_REQUEST]
        )
        assert r.status_code == 200
        items = r.json()
        assert len(items) == 2
        assert "error" in items[0]
        assert "predicted_utilization_percent" in items[1]
        
        # Reset
        api_module.predictor.predict = original_predict


# ── /routing-cost ──────────────────────────────────────────────────────────────

class TestRoutingCostEndpoint:
    def test_returns_200(self, client_with_predictor):
        r = client_with_predictor.post(
            "/routing-cost",
            json={
                "predicted_utilization_percent": 30.0,
                "current_metrics": {"link": "R1-R2"},
            },
        )
        assert r.status_code == 200

    def test_response_fields(self, client_with_predictor):
        r = client_with_predictor.post(
            "/routing-cost",
            json={
                "predicted_utilization_percent": 30.0,
                "current_metrics": {"link": "R1-R2"},
            },
        )
        data = r.json()
        assert "link" in data
        assert "predicted_cost" in data
        assert "risk" in data
        assert "predicted_utilization_percent" in data
        assert "predicted_utilization" in data

    def test_cost_is_non_negative(self, client_with_predictor):
        r = client_with_predictor.post(
            "/routing-cost",
            json={
                "predicted_utilization_percent": 10.0,
                "current_metrics": {"link": "X"},
            },
        )
        assert r.json()["predicted_cost"] >= 0.0

    def test_high_risk_link_has_higher_cost(self, client_with_predictor):
        def _get_cost(pct):
            r = client_with_predictor.post(
                "/routing-cost",
                json={
                    "predicted_utilization_percent": pct,
                    "current_metrics": {"link": "X"},
                },
            )
            return r.json()["predicted_cost"]

        assert _get_cost(80.0) > _get_cost(20.0)

    def test_fractional_field_matches_pct_div_100(self, client_with_predictor):
        r = client_with_predictor.post(
            "/routing-cost",
            json={
                "predicted_utilization_percent": 40.0,
                "current_metrics": {"link": "X"},
            },
        )
        data = r.json()
        assert abs(data["predicted_utilization"] - 0.40) < 1e-9
