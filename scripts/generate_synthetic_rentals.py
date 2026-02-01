from __future__ import annotations

import argparse
import random
from pathlib import Path

import numpy as np
import pandas as pd


def parse_price(value: str) -> float:
    text = str(value).replace("$", "").replace(",", "").replace('"', "").strip()
    try:
        return float(text)
    except ValueError:
        return float("nan")


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def synthesize(
    df: pd.DataFrame,
    target_rows: int,
    price_jitter: float,
    coord_jitter: float,
    seed: int,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    df = df.copy()
    df["price_value"] = df["Price"].map(parse_price)
    df = df.dropna(subset=["price_value", "Lat", "Long"])

    if df.empty:
        raise ValueError("No usable rows after parsing price/coords.")

    # Build simple distributions by bedroom count.
    groups = df.groupby("Bedroom")
    group_keys = list(groups.groups.keys())
    group_weights = np.array([len(groups.get_group(k)) for k in group_keys], dtype=float)
    group_weights = group_weights / group_weights.sum()

    synthetic_rows = []
    for _ in range(target_rows):
        bedroom = rng.choice(group_keys, p=group_weights)
        base = groups.get_group(bedroom).sample(1, random_state=rng.integers(0, 2**32 - 1)).iloc[0]

        base_price = float(base["price_value"])
        price_noise = rng.normal(0, price_jitter)
        price_value = max(600.0, base_price * (1 + price_noise))

        lat = float(base["Lat"]) + rng.normal(0, coord_jitter)
        lon = float(base["Long"]) + rng.normal(0, coord_jitter)

        synthetic_rows.append(
            {
                "Bedroom": int(base["Bedroom"]),
                "Bathroom": int(base["Bathroom"]),
                "Den": int(base["Den"]),
                "Address": f"Synthetic near {base['Address']}",
                "Lat": lat,
                "Long": lon,
                "Price": f"${price_value:,.2f}",
                "Synthetic": True,
            }
        )

    out_df = pd.DataFrame(synthetic_rows)
    return out_df


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic rental listings.")
    parser.add_argument("--input", required=True, help="Path to source CSV")
    parser.add_argument("--output", required=True, help="Path to output CSV")
    parser.add_argument("--rows", type=int, default=2000, help="Number of synthetic rows")
    parser.add_argument(
        "--price-jitter",
        type=float,
        default=0.12,
        help="Std dev for price noise (fraction of base price)",
    )
    parser.add_argument(
        "--coord-jitter",
        type=float,
        default=0.0025,
        help="Std dev for lat/lon jitter (degrees)",
    )
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    df = pd.read_csv(input_path)
    out_df = synthesize(
        df,
        target_rows=args.rows,
        price_jitter=args.price_jitter,
        coord_jitter=args.coord_jitter,
        seed=args.seed,
    )
    out_df.to_csv(output_path, index=False)


if __name__ == "__main__":
    main()
