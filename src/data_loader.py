"""
data_loader.py
==============
Loads the Abilene ML dataset splits (train, validation, test).

Path Resolution:
----------------
Checks both:
1. Kaggle-style nested folder: <DATASET_DIR>/abilene_ml_<split>.csv/abilene_ml_<split>.csv
2. Flat layout: <DATASET_DIR>/abilene_ml_<split>.csv

The dataset directory defaults to sibling directory `../dataset` relative to
`prediction_layer`, and can be customized via the DATASET_DIR environment variable.
"""

import os
from pathlib import Path
from typing import Optional
import pandas as pd


def get_project_root() -> Path:
    """Return the root path of the prediction_layer module."""
    return Path(__file__).resolve().parent.parent


def get_dataset_dir() -> Path:
    """Resolve the dataset directory."""
    default_dir = get_project_root().parent / "dataset"
    env_dir = os.getenv("DATASET_DIR")
    return Path(env_dir) if env_dir else default_dir


def resolve_split_path(split: str, dataset_dir: Optional[Path] = None) -> Path:
    """
    Locates the CSV file for a given split ('train', 'val', or 'test').
    Supports both nested directory and flat file layouts.
    """
    valid_splits = ("train", "val", "test")
    if split not in valid_splits:
        raise ValueError(f"Invalid split '{split}'. Expected one of: {valid_splits}")

    base_dir = dataset_dir or get_dataset_dir()
    nested_path = base_dir / f"abilene_ml_{split}.csv" / f"abilene_ml_{split}.csv"
    flat_path = base_dir / f"abilene_ml_{split}.csv"

    if nested_path.is_file():
        return nested_path
    if flat_path.is_file():
        return flat_path

    raise FileNotFoundError(
        f"Could not find dataset split '{split}' in {base_dir}.\n"
        f"Checked paths:\n"
        f"  1. {nested_path}\n"
        f"  2. {flat_path}\n"
        f"Please verify that the dataset exists or set the DATASET_DIR environment variable."
    )


def load_data(split: str = "train", nrows: Optional[int] = None) -> pd.DataFrame:
    """
    Loads a dataset split into a pandas DataFrame.

    Parameters
    ----------
    split : str
        'train', 'val', or 'test'
    nrows : int, optional
        Maximum number of rows to read. Useful for lightweight benchmarking
        without loading the entire CSV into memory.

    Returns
    -------
    pd.DataFrame
        DataFrame sorted chronologically by timestamp and link_index.
    """
    target_path = resolve_split_path(split)

    df = pd.read_csv(target_path, nrows=nrows)

    # Ensure chronological sorting
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        sort_cols = ["timestamp"]
        if "link_index" in df.columns:
            sort_cols.append("link_index")
        df = df.sort_values(by=sort_cols).reset_index(drop=True)

    return df
