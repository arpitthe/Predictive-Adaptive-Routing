"""
predictor.py
============
Production inference module for the Prediction & ML Layer.

Primary model : amazon/chronos-2  (Chronos2Pipeline, univariate zero-shot)
Fallback      : Moving Average (util_mean_3) when the neural model is unavailable

Context window convention:
-------------------------
Default 6 points:
    util_lag_5, util_lag_4, util_lag_3, util_lag_2, util_lag_1, utilization_pct
    (oldest to newest, 6 points = 30 minutes of telemetry history sampled at 5 min).

Extensible Context:
-------------------
Alternatively, callers (such as Daksh's monitoring controller) may provide a
'history' or 'context' key containing an arbitrary-length 1D sequence of historical
utilization values (floats, oldest to newest, >= 2 points).

Units:
------
Input utilization values must be on the 0–100 percentage-point scale.
Output predicted_utilization_percent is on the 0–100 percentage-point scale.
Output predicted_utilization is the fractional form (0.0 to 1.0) for downstream compatibility.
"""

import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import torch
import yaml
from chronos import Chronos2Pipeline

DEFAULT_MODEL_ID = "amazon/chronos-2"

# Default 6-point context window (oldest -> newest)
LAG_COLS = [
    "util_lag_5",
    "util_lag_4",
    "util_lag_3",
    "util_lag_2",
    "util_lag_1",
    "utilization_pct",
]

MEDIAN_QUANTILE_IDX = 10  # Index 10 of 21 output quantiles = 0.50 (median)


def _load_predictor_config() -> Dict[str, Any]:
    config_path = (
        Path(__file__).resolve().parent.parent / "config" / "config.yaml"
    )
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}
    return {}


class LinkUtilizationPredictor:
    """
    Zero-shot link utilization predictor backed by amazon/chronos-2.

    Usage
    -----
        predictor = LinkUtilizationPredictor.load()
        result = predictor.predict(sample_dict)
        batch_results = predictor.predict_batch([sample_1, sample_2])
    """

    def __init__(
        self,
        model_id: Optional[str] = None,
        device: Optional[str] = None,
        high_threshold: Optional[float] = None,
        batch_size: Optional[int] = None,
    ):
        config = _load_predictor_config()
        model_cfg = config.get("model", {})
        congestion_cfg = config.get("congestion", {})

        self.model_id = model_id or model_cfg.get("model_id", DEFAULT_MODEL_ID)

        # Device selection: "auto", "cuda", or "cpu"
        configured_device = device or model_cfg.get("device", "auto")
        if configured_device == "auto":
            self.device = "cuda" if torch.cuda.is_available() else "cpu"
        else:
            self.device = configured_device

        # Quantile index configuration
        self.median_idx = int(
            model_cfg.get("median_quantile_idx", MEDIAN_QUANTILE_IDX)
        )

        # Batch size for internal chunking
        self.batch_size = int(batch_size or model_cfg.get("batch_size", 64))

        # Congestion threshold (0-100 scale)
        self.high_threshold = float(
            high_threshold
            if high_threshold is not None
            else congestion_cfg.get("high_threshold", 50.0)
        )

        # Dtype selection
        dtype_str = model_cfg.get("dtype", "float32")
        self.torch_dtype = (
            torch.bfloat16
            if (dtype_str == "bfloat16" and self.device == "cuda")
            else torch.float32
        )

        # Initialize pipeline once
        self.pipeline = Chronos2Pipeline.from_pretrained(
            self.model_id,
            device_map=self.device,
            dtype=self.torch_dtype,
        )

    @classmethod
    def load(cls, model_path: Optional[str] = None) -> "LinkUtilizationPredictor":
        """
        Factory method. model_path is ignored — this is a zero-shot foundation model;
        weights are loaded via Chronos2Pipeline from Hugging Face or local HF cache.
        """
        return cls()

    @staticmethod
    def extract_and_validate_context(sample: Dict[str, Any]) -> Tuple[np.ndarray, float, str, str]:
        """
        Validates input sample fields, checks numeric bounds, and returns:
            (context_array, current_utilization_pct, link_name, timestamp)

        Raises ValueError on missing, NaN, infinite, or out-of-range data.
        """
        if not isinstance(sample, dict):
            raise ValueError(f"Sample must be a dictionary, got {type(sample).__name__}")

        link = str(sample.get("link", "UNKNOWN")).strip() or "UNKNOWN"
        timestamp = str(sample.get("timestamp", ""))

        # Check capacity if provided
        if "capacity_kbps" in sample and sample["capacity_kbps"] is not None:
            try:
                cap = float(sample["capacity_kbps"])
                if math.isnan(cap) or math.isinf(cap) or cap <= 0:
                    raise ValueError(f"capacity_kbps must be positive and finite, got {cap}")
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid capacity_kbps on link '{link}': {exc}") from exc

        # Check traffic if provided
        if "traffic_kbps" in sample and sample["traffic_kbps"] is not None:
            try:
                traffic = float(sample["traffic_kbps"])
                if math.isnan(traffic) or math.isinf(traffic) or traffic < 0:
                    raise ValueError(f"traffic_kbps must be non-negative and finite, got {traffic}")
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Invalid traffic_kbps on link '{link}': {exc}") from exc

        # 1. Flexible context: check for explicit 'history' or 'context' sequence
        history_seq = sample.get("history") or sample.get("context")
        if history_seq is not None:
            if not isinstance(history_seq, (list, tuple, np.ndarray)):
                raise ValueError(
                    f"Provided context/history for link '{link}' must be a sequence of numbers."
                )
            if len(history_seq) < 2:
                raise ValueError(
                    f"History sequence for link '{link}' must contain at least 2 points, got {len(history_seq)}"
                )
            context_vals = []
            for idx, pt in enumerate(history_seq):
                try:
                    val = float(pt)
                except (TypeError, ValueError):
                    raise ValueError(
                        f"Non-numeric value {pt!r} at index {idx} in history for link '{link}'"
                    )
                if math.isnan(val) or math.isinf(val):
                    raise ValueError(
                        f"Non-finite value {val} at index {idx} in history for link '{link}'"
                    )
                if val < 0.0 or val > 100.0:
                    raise ValueError(
                        f"Utilization {val}% at index {idx} outside [0, 100]% range for link '{link}'"
                    )
                context_vals.append(val)

            current_pct = context_vals[-1]
            return np.array(context_vals, dtype=np.float32), current_pct, link, timestamp

        # 2. Standard 6-point context window from lag columns
        context_vals = []
        for col in LAG_COLS:
            if col not in sample or sample[col] is None:
                raise ValueError(
                    f"Missing required context feature '{col}' for link '{link}'. "
                    f"Required fields: {LAG_COLS}"
                )
            try:
                val = float(sample[col])
            except (TypeError, ValueError):
                raise ValueError(
                    f"Feature '{col}' for link '{link}' must be numeric, got {sample[col]!r}"
                )
            if math.isnan(val) or math.isinf(val):
                raise ValueError(
                    f"Feature '{col}' for link '{link}' must be finite, got {val}"
                )
            if val < 0.0 or val > 100.0:
                raise ValueError(
                    f"Feature '{col}'={val}% for link '{link}' outside physically valid range [0, 100]%"
                )
            context_vals.append(val)

        current_pct = context_vals[-1]  # 'utilization_pct' is last in LAG_COLS
        return np.array(context_vals, dtype=np.float32), current_pct, link, timestamp

    def predict(self, sample: Dict[str, Any]) -> Dict[str, Any]:
        """
        Predict next-5-minute link utilization (zero-shot, single sample).

        Parameters
        ----------
        sample : dict
            Contains lag columns ('util_lag_5'..'util_lag_1', 'utilization_pct')
            OR 'history'/'context' list. Optional 'link', 'timestamp'.

        Returns
        -------
        dict with keys:
            link, timestamp, model, prediction_horizon_minutes,
            current_utilization, predicted_utilization,
            predicted_utilization_percent, congestion_risk, status
        """
        context_arr, current_pct, link, timestamp = self.extract_and_validate_context(sample)

        with torch.inference_mode():
            forecasts = self.pipeline.predict(
                inputs=[context_arr],
                prediction_length=1,
                batch_size=1,
            )

        # forecasts[0] shape: (1, 21, 1) -> median at self.median_idx
        raw_pred = float(forecasts[0][0, self.median_idx, 0].item())
        pred_pct = min(100.0, max(0.0, raw_pred))
        risk = "HIGH" if pred_pct > self.high_threshold else "LOW"

        return {
            "link": link,
            "timestamp": timestamp,
            "model": self.model_id,
            "prediction_horizon_minutes": 5,
            "current_utilization": current_pct / 100.0,
            "predicted_utilization": pred_pct / 100.0,
            "predicted_utilization_percent": pred_pct,
            "congestion_risk": risk,
            "status": "ok",
        }

    def predict_batch(self, samples: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Predict next-5-minute utilization for multiple links in an efficient single
        model call while isolating errors for invalid samples.

        Parameters
        ----------
        samples : list of dicts

        Returns
        -------
        list of dicts, preserving exact input ordering.
        Failed items contain {"link": ..., "error": ..., "status": "error"}.
        """
        if not samples:
            return []

        results: List[Optional[Dict[str, Any]]] = [None] * len(samples)
        valid_indices: List[int] = []
        valid_contexts: List[np.ndarray] = []
        valid_meta: List[Tuple[float, str, str]] = []

        # 1. Validate all samples individually
        for idx, sample in enumerate(samples):
            try:
                context_arr, current_pct, link, timestamp = self.extract_and_validate_context(sample)
                valid_indices.append(idx)
                valid_contexts.append(context_arr)
                valid_meta.append((current_pct, link, timestamp))
            except Exception as exc:
                link_id = "UNKNOWN"
                if isinstance(sample, dict):
                    link_id = str(sample.get("link", "UNKNOWN")).strip() or "UNKNOWN"
                results[idx] = {
                    "link": link_id,
                    "error": str(exc),
                    "status": "error",
                }

        # 2. Run batched inference on all valid contexts at once
        if valid_contexts:
            with torch.inference_mode():
                forecasts = self.pipeline.predict(
                    inputs=valid_contexts,
                    prediction_length=1,
                    batch_size=min(self.batch_size, len(valid_contexts)),
                )

            for i, forecast in enumerate(forecasts):
                original_idx = valid_indices[i]
                current_pct, link, timestamp = valid_meta[i]

                raw_pred = float(forecast[0, self.median_idx, 0].item())
                pred_pct = min(100.0, max(0.0, raw_pred))
                risk = "HIGH" if pred_pct > self.high_threshold else "LOW"

                results[original_idx] = {
                    "link": link,
                    "timestamp": timestamp,
                    "model": self.model_id,
                    "prediction_horizon_minutes": 5,
                    "current_utilization": current_pct / 100.0,
                    "predicted_utilization": pred_pct / 100.0,
                    "predicted_utilization_percent": pred_pct,
                    "congestion_risk": risk,
                    "status": "ok",
                }

        # Guarantee no None entries
        return [res for res in results if res is not None]
