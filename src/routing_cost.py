import yaml
import os
from pathlib import Path

def load_config():
    config_path = Path(__file__).resolve().parent.parent / "config" / "config.yaml"
    if not config_path.exists():
        return {"congestion": {"high_threshold": 50.0}}
    with open(config_path, 'r') as f:
        return yaml.safe_load(f)

def prediction_to_routing_cost(predicted_utilization_pct, current_metrics):
    """
    Converts predicted utilization into a routing cost that Dijkstra can consume.
    Does NOT perform route selection.
    
    predicted_utilization_pct: Float (0-100 scale)
    current_metrics: Dictionary containing at least 'link' and 'utilization_pct'
    """
    config = load_config()
    high_threshold = config.get("congestion", {}).get("high_threshold", 50.0)
    
    # Safely bound the input to the physically valid 0-100 percentage-point range
    predicted_utilization_pct = min(100.0, max(0.0, float(predicted_utilization_pct)))
    
    # Simple rule-based cost mapping:
    # Cost is fundamentally based on predicted utilization to proactively avoid congestion.
    # Base cost = 1.0 (minimum cost)
    # If predicted utilization > high_threshold, we penalize the link heavily.
    
    base_cost = 1.0
    
    # We add a term proportional to predicted utilization
    # For example, +1 cost for every 10% utilization
    cost = base_cost + (predicted_utilization_pct / 10.0)
    
    risk = "LOW"
    if predicted_utilization_pct > high_threshold:
        risk = "HIGH"
        # Heavy penalty for high risk of congestion
        cost += 100.0
        
    return {
        "link": current_metrics.get("link", "UNKNOWN"),
        "predicted_utilization": predicted_utilization_pct / 100.0,
        "predicted_utilization_percent": float(predicted_utilization_pct),
        "predicted_cost": float(cost),
        "risk": risk
    }
