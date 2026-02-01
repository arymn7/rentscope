import math
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from snowflake_client import snowflake_configured, fetch_crime_events, fetch_ttc_stops

load_dotenv()

DATA_DIR = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "sample"))

app = FastAPI(title="Utrahacks MCP Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)


class MCPRequest(BaseModel):
    tool: str
    args: Dict[str, Any]


CRIME_DF: pd.DataFrame | None = None
TTC_DF: pd.DataFrame | None = None
POI_DF: pd.DataFrame | None = None
RENT_DF: pd.DataFrame | None = None


@app.get("/health")
async def health():
    return {"ok": True, "time": datetime.utcnow().isoformat()}


def haversine_km(lat1, lon1, lat2, lon2):
    r = 6371
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def ensure_data_loaded():
    global CRIME_DF, TTC_DF, POI_DF, RENT_DF
    if CRIME_DF is None:
        crime_path = os.path.join(DATA_DIR, "crime_events.csv")
        CRIME_DF = pd.read_csv(crime_path, parse_dates=["event_date"])
    if TTC_DF is None:
        ttc_path = os.path.join(DATA_DIR, "ttc_stops.csv")
        TTC_DF = pd.read_csv(ttc_path)
    if POI_DF is None:
        poi_path = os.path.join(DATA_DIR, "pois.csv")
        POI_DF = pd.read_csv(poi_path)
    if RENT_DF is None:
        rent_dir = os.getenv(
            "RENT_DATA_DIR",
            os.path.join(os.path.dirname(__file__), "..", "data", "rent-prices")
        )
        files = [
            os.path.join(rent_dir, name)
            for name in os.listdir(rent_dir)
            if name.lower().endswith(".csv")
        ]
        frames = []
        for path in files:
            df = pd.read_csv(path)
            if {"Lat", "Long", "Price"}.issubset(df.columns):
                frames.append(df)
        RENT_DF = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
        if not RENT_DF.empty:
            RENT_DF["price_value"] = (
                RENT_DF["Price"].astype(str)
                .str.replace("$", "", regex=False)
                .str.replace(",", "", regex=False)
                .str.replace('"', "", regex=False)
            )
            RENT_DF["price_value"] = pd.to_numeric(RENT_DF["price_value"], errors="coerce")
            RENT_DF = RENT_DF.dropna(subset=["price_value", "Lat", "Long"])


def get_bbox(lat: float, lon: float, radius_m: float):
    delta_lat = radius_m / 111000
    delta_lon = radius_m / (111000 * math.cos(math.radians(lat)))
    return lat - delta_lat, lat + delta_lat, lon - delta_lon, lon + delta_lon


def crime_summary(lat: float, lon: float, radius_m: float, window_days: int):
    radius_km = radius_m / 1000
    cutoff_date = datetime.utcnow() - timedelta(days=window_days)

    lat_min, lat_max, lon_min, lon_max = get_bbox(lat, lon, radius_m)

    if snowflake_configured():
        df = fetch_crime_events(lat_min, lat_max, lon_min, lon_max, cutoff_date.strftime("%Y-%m-%d"))
        df["event_date"] = pd.to_datetime(df["event_date"])
    else:
        ensure_data_loaded()
        df = CRIME_DF.copy()
        df = df[df["event_date"] >= cutoff_date]
        df = df[(df["lat"] >= lat_min) & (df["lat"] <= lat_max) & (df["lon"] >= lon_min) & (df["lon"] <= lon_max)]

    if df.empty:
        return {
            "counts_by_type": {},
            "rate_hint": "unknown",
            "trend_hint": "unknown",
            "source": "Toronto Police open data (sample)",
            "updated_at": datetime.utcnow().strftime("%Y-%m-%d")
        }

    df["dist_km"] = df.apply(lambda row: haversine_km(lat, lon, row["lat"], row["lon"]), axis=1)
    df = df[df["dist_km"] <= radius_km]

    counts = df.groupby("event_type").size().to_dict()
    total = df.shape[0]
    area_km2 = math.pi * radius_km ** 2
    rate = total / area_km2 if area_km2 > 0 else total

    if rate < 2:
        rate_hint = "lower"
    elif rate < 5:
        rate_hint = "moderate"
    else:
        rate_hint = "higher"

    midpoint = cutoff_date + timedelta(days=window_days / 2)
    early = df[df["event_date"] < midpoint].shape[0]
    late = df[df["event_date"] >= midpoint].shape[0]
    if late > early + 2:
        trend_hint = "upward"
    elif early > late + 2:
        trend_hint = "downward"
    else:
        trend_hint = "stable"

    return {
        "counts_by_type": counts,
        "rate_hint": rate_hint,
        "trend_hint": trend_hint,
        "source": "Toronto Police open data (sample)" if not snowflake_configured() else "Snowflake: crime_events",
        "updated_at": datetime.utcnow().strftime("%Y-%m-%d")
    }


def commute_proxy(lat: float, lon: float, campus_lat: float, campus_lon: float):
    ensure_data_loaded()
    dist_km = haversine_km(lat, lon, campus_lat, campus_lon)
    est_minutes = max(8, int(dist_km / 20 * 60))

    lat_min, lat_max, lon_min, lon_max = get_bbox(lat, lon, 1500)
    if snowflake_configured():
        stops = fetch_ttc_stops(lat_min, lat_max, lon_min, lon_max)
    else:
        stops = TTC_DF.copy()
        stops = stops[(stops["lat"] >= lat_min) & (stops["lat"] <= lat_max) & (stops["lon"] >= lon_min) & (stops["lon"] <= lon_max)]

    near_hint = "no TTC stop data"
    if not stops.empty:
        stops["dist_km"] = stops.apply(lambda row: haversine_km(lat, lon, row["lat"], row["lon"]), axis=1)
        min_dist = stops["dist_km"].min()
        if min_dist < 0.5:
            near_hint = "near TTC stop (<500m)"
        elif min_dist < 1.2:
            near_hint = "moderate TTC access (~1km)"
        else:
            near_hint = "far from TTC stop (>1km)"
    return {
        "distance_km": round(dist_km, 2),
        "est_minutes": est_minutes,
        "near_transit_hint": near_hint,
        "source": "TTC stops (sample)" if not snowflake_configured() else "Snowflake: ttc_stops"
    }


def nearby_pois(lat: float, lon: float, categories: List[str], radius_m: float):
    ensure_data_loaded()
    radius_km = radius_m / 1000

    pois = POI_DF.copy()
    if categories:
        pois = pois[pois["category"].isin(categories)]

    pois["dist_km"] = pois.apply(lambda row: haversine_km(lat, lon, row["lat"], row["lon"]), axis=1)
    pois = pois[pois["dist_km"] <= radius_km]
    pois = pois.sort_values("dist_km")

    results = [
        {
            "name": row["name"],
            "category": row["category"],
            "dist_m": int(row["dist_km"] * 1000)
        }
        for _, row in pois.head(25).iterrows()
    ]

    counts = pois.groupby("category").size().to_dict()

    return {
        "results": results,
        "counts_by_category": counts,
        "source": "Seeded POI dataset"
    }


def rent_grid(
    bounds: Dict[str, float] | None,
    cell_km: float,
    min_count: int,
    price_min: float | None,
    price_max: float | None
):
    ensure_data_loaded()
    if RENT_DF is None or RENT_DF.empty:
        return {"type": "FeatureCollection", "features": [], "source": "rent-prices"}

    df = RENT_DF.copy()

    if bounds:
        df = df[
            (df["Lat"] >= bounds["lat_min"])
            & (df["Lat"] <= bounds["lat_max"])
            & (df["Long"] >= bounds["lon_min"])
            & (df["Long"] <= bounds["lon_max"])
        ]

    if price_min is not None:
        df = df[df["price_value"] >= price_min]
    if price_max is not None:
        df = df[df["price_value"] <= price_max]

    if df.empty:
        return {"type": "FeatureCollection", "features": [], "source": "rent-prices"}

    lat_min = bounds["lat_min"] if bounds else df["Lat"].min()
    lon_min = bounds["lon_min"] if bounds else df["Long"].min()
    mean_lat = df["Lat"].mean()

    delta_lat = cell_km / 111.0
    delta_lon = cell_km / (111.0 * math.cos(math.radians(mean_lat)))

    df["grid_x"] = ((df["Long"] - lon_min) / delta_lon).astype(int)
    df["grid_y"] = ((df["Lat"] - lat_min) / delta_lat).astype(int)

    grouped = (
        df.groupby(["grid_x", "grid_y"])
        .agg(avg_price=("price_value", "mean"), count=("price_value", "size"))
        .reset_index()
    )

    features = []
    for _, row in grouped.iterrows():
        if row["count"] < min_count:
            continue
        x = int(row["grid_x"])
        y = int(row["grid_y"])
        cell_lon_min = lon_min + x * delta_lon
        cell_lon_max = cell_lon_min + delta_lon
        cell_lat_min = lat_min + y * delta_lat
        cell_lat_max = cell_lat_min + delta_lat
        polygon = [
            [cell_lon_min, cell_lat_min],
            [cell_lon_max, cell_lat_min],
            [cell_lon_max, cell_lat_max],
            [cell_lon_min, cell_lat_max],
            [cell_lon_min, cell_lat_min]
        ]
        features.append(
            {
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [polygon]},
                "properties": {
                    "cell_id": f"{x}-{y}",
                    "avg_price": round(float(row["avg_price"]), 2),
                    "count": int(row["count"])
                }
            }
        )

    return {"type": "FeatureCollection", "features": features, "source": "rent-prices"}


@app.post("/mcp")
async def mcp(request: MCPRequest):
    try:
        tool = request.tool
        args = request.args
        if tool == "crime_summary":
            data = crime_summary(
                float(args["lat"]),
                float(args["lon"]),
                float(args["radius_m"]),
                int(args["window_days"])
            )
        elif tool == "commute_proxy":
            data = commute_proxy(
                float(args["lat"]),
                float(args["lon"]),
                float(args["campus_lat"]),
                float(args["campus_lon"])
            )
        elif tool == "nearby_pois":
            data = nearby_pois(
                float(args["lat"]),
                float(args["lon"]),
                list(args["categories"]),
                float(args["radius_m"])
            )
        elif tool == "rent_grid":
            bounds = args.get("bounds")
            data = rent_grid(
                bounds=bounds if isinstance(bounds, dict) else None,
                cell_km=float(args.get("cell_km", 1.0)),
                min_count=int(args.get("min_count", 3)),
                price_min=float(args["price_min"]) if args.get("price_min") is not None else None,
                price_max=float(args["price_max"]) if args.get("price_max") is not None else None
            )
        else:
            return {"ok": False, "error": "Unknown tool"}

        return {"ok": True, "data": data}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
