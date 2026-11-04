import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

import src.api as api_module

def test_debug_1():
    print(f"\nBefore test 1: predictor is {api_module.predictor}")
    mock_pred = MagicMock()
    with patch("src.api.LinkUtilizationPredictor.load", return_value=mock_pred):
        with TestClient(api_module.app, raise_server_exceptions=True) as client:
            print(f"Inside TestClient 1: predictor is {api_module.predictor}")
            r = client.get("/health")
            print(f"Response 1: {r.json()}")

def test_debug_2():
    print(f"\nBefore test 2: predictor is {api_module.predictor}")
    
    # Store original state
    orig_predictor = api_module.predictor
    orig_error = api_module._startup_error
    
    # Force predictor to None so the load failure leaves it as None
    api_module.predictor = None
    
    with patch("src.api.LinkUtilizationPredictor.load", side_effect=RuntimeError("Fail")):
        with TestClient(api_module.app, raise_server_exceptions=False) as client:
            print(f"Inside TestClient 2: predictor is {api_module.predictor}")
            r = client.get("/health")
            print(f"Response 2: {r.json()}")

    api_module.predictor = orig_predictor
    api_module._startup_error = orig_error
