import pandas as pd
from pathlib import Path
import os

def get_project_root():
    return Path(__file__).resolve().parent.parent

def load_data(split='train'):
    default_dataset_dir = get_project_root().parent / "dataset"
    dataset_dir = Path(os.getenv("DATASET_DIR", default_dataset_dir))
    
    paths = {
        "train": dataset_dir / "abilene_ml_train.csv" / "abilene_ml_train.csv",
        "val": dataset_dir / "abilene_ml_val.csv" / "abilene_ml_val.csv",
        "test": dataset_dir / "abilene_ml_test.csv" / "abilene_ml_test.csv"
    }
    
    if split not in paths:
        raise ValueError(f"Invalid split. Choose from {list(paths.keys())}")
        
    df = pd.read_csv(paths[split])
    
    # Sort by time just in case, though they should be
    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values(by=['timestamp', 'link_index']).reset_index(drop=True)
    return df
