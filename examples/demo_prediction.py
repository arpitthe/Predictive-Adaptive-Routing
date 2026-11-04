"""
demo_prediction.py
==================
Runs a single prediction using the production predictor (amazon/chronos-2)
on a real sample from the test set.

Shows: current utilization, context window, predicted next utilization,
congestion risk, and routing cost output.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.predictor import LinkUtilizationPredictor
from src.routing_cost import prediction_to_routing_cost
from src.data_loader import load_data


def run_demo():
    print("Loading test dataset ...")
    test_df = load_data("test")

    # Pick the sample with the highest utilization for a dramatic example
    sample_idx = test_df["utilization_pct"].idxmax()
    row = test_df.loc[sample_idx]

    sample = row.to_dict()
    sample["link"] = f"{row['src']}-{row['dst']}"

    print("Loading Predictor (amazon/chronos-2) ...")
    predictor = LinkUtilizationPredictor.load()

    print("Making prediction ...")
    pred = predictor.predict(sample)

    cost = prediction_to_routing_cost(pred["predicted_utilization_percent"], pred)

    lag_cols = ["util_lag_5", "util_lag_4", "util_lag_3",
                "util_lag_2", "util_lag_1", "utilization_pct"]

    print()
    print("=" * 48)
    print("  PREDICTIVE LINK CONDITION FORECAST")
    print("=" * 48)
    print(f"  Model     : {pred['model']}")
    print(f"  Link      : {pred['link']}")
    print(f"  Timestamp : {pred['timestamp']}")
    print()
    print("  Context window (oldest to newest):")
    for col in lag_cols:
        print(f"    {col:20s}: {sample[col]:.2f}%")
    print()
    print(f"  Current utilization         : {pred['current_utilization']*100:.1f}%")
    print(f"  Predicted utilization +5min : {pred['predicted_utilization_percent']:.1f}%")
    print(f"  Congestion risk             : {pred['congestion_risk']}")
    print(f"  Predicted routing cost      : {cost['predicted_cost']:.2f}")
    print("=" * 48)
    print()
    print("Routing cost output (for Ritu's Dijkstra engine):")
    print(cost)


if __name__ == "__main__":
    run_demo()
