import argparse
import json
import os
import time
from typing import Iterable, List, Tuple

import requests


def build_grid(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float, step_km: float
) -> Iterable[Tuple[float, float]]:
    lat_step = step_km / 111.0
    lat = lat_min
    while lat <= lat_max:
        lon_step = step_km / (111.0 * max(0.2, abs(math.cos(math.radians(lat)))))
        lon = lon_min
        while lon <= lon_max:
            yield (round(lat, 5), round(lon, 5))
            lon += lon_step
        lat += lat_step


def call_mcp(mcp_url: str, lat: float, lon: float, categories: List[str], radius_m: int):
    payload = {
        "tool": "nearby_pois",
        "args": {"lat": lat, "lon": lon, "categories": categories, "radius_m": radius_m}
    }
    response = requests.post(mcp_url, json=payload, timeout=30)
    response.raise_for_status()
    data = response.json()
    if not data.get("ok"):
        raise RuntimeError(data.get("error", "MCP error"))
    return data.get("data")


def main():
    parser = argparse.ArgumentParser(description="Pre-cache Overpass amenities into MongoDB via MCP.")
    parser.add_argument("--mcp-url", default=os.getenv("MCP_URL", "http://localhost:7000/mcp"))
    parser.add_argument("--lat-min", type=float, default=43.58)
    parser.add_argument("--lat-max", type=float, default=43.86)
    parser.add_argument("--lon-min", type=float, default=-79.64)
    parser.add_argument("--lon-max", type=float, default=-79.12)
    parser.add_argument("--step-km", type=float, default=2.0)
    parser.add_argument("--radius-m", type=int, default=600)
    parser.add_argument("--categories", default="grocery,cafe")
    parser.add_argument("--sleep-sec", type=float, default=0.6)
    args = parser.parse_args()

    categories = [item.strip() for item in args.categories.split(",") if item.strip()]
    if not categories:
        raise SystemExit("No categories provided.")

    total = 0
    errors = 0
    for lat, lon in build_grid(args.lat_min, args.lat_max, args.lon_min, args.lon_max, args.step_km):
        total += 1
        try:
            data = call_mcp(args.mcp_url, lat, lon, categories, args.radius_m)
            counts = data.get("counts_by_category", {})
            print(f"{total:04d} {lat},{lon} -> {json.dumps(counts)}")
        except Exception as exc:
            errors += 1
            print(f"{total:04d} {lat},{lon} -> error: {exc}")
        time.sleep(args.sleep_sec)

    print(f"Done. Requests: {total}, errors: {errors}")


if __name__ == "__main__":
    import math

    main()
