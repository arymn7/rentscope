import math
import os
from datetime import datetime, timedelta
from typing import Any, Dict, List

import pandas as pd
import requests
from pymongo import MongoClient
from pymongo.errors import PyMongoError
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from snowflake_client import snowflake_configured, fetch_crime_events, fetch_ttc_stops, fetch_rent_prices

load_dotenv()

DATA_DIR = os.getenv("DATA_DIR", os.path.join(os.path.dirname(__file__), "..", "data", "sample"))
MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "utrahacks")
POI_CACHE_COLLECTION = os.getenv("POI_CACHE_COLLECTION", "poi_cache")
POI_CACHE_TTL_SEC = int(os.getenv("POI_CACHE_TTL_SEC", "86400"))
RENT_TABLE = os.getenv("SNOWFLAKE_RENT_TABLE", "TORONTO_RENT_PRICES")

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
RENT_DF: pd.DataFrame | None = None
_mongo_client: MongoClient | None = None


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
    global CRIME_DF, TTC_DF, RENT_DF
    if CRIME_DF is None:
        CRIME_DF = pd.DataFrame()
    if TTC_DF is None:
        ttc_path = os.path.join(DATA_DIR, "ttc_stops.csv")
        TTC_DF = pd.read_csv(ttc_path)
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


def _get_mongo_collection():
    global _mongo_client
    if not MONGO_URI:
        return None
    try:
        if _mongo_client is None:
            _mongo_client = MongoClient(MONGO_URI)
        collection = _mongo_client[MONGO_DB][POI_CACHE_COLLECTION]
        collection.create_index("expires_at", expireAfterSeconds=0)
        collection.create_index("key", unique=True)
        return collection
    except PyMongoError:
        return None


def _cache_key(lat: float, lon: float, radius_m: float, categories: List[str]) -> str:
    key = f"{round(lat, 4)}:{round(lon, 4)}:{int(radius_m)}:{','.join(sorted(categories))}"
    return key


TPS_MCI_URL = "https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/Major_Crime_Indicators_Open_Data/FeatureServer/0/query"


def _fetch_tps_mci(lat: float, lon: float, radius_m: float, window_days: int) -> dict:
    lat_min, lat_max, lon_min, lon_max = get_bbox(lat, lon, radius_m)
    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=window_days)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    where = f"REPORT_DATE >= {start_ms} AND REPORT_DATE <= {end_ms}"
    params = {
        "f": "json",
        "where": where,
        "geometry": f"{lon_min},{lat_min},{lon_max},{lat_max}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "MCI_CATEGORY,OFFENCE,REPORT_DATE,OCC_DATE,EVENT_UNIQUE_ID,LAT_WGS84,LONG_WGS84",
        "resultRecordCount": 2000
    }
    response = requests.get(TPS_MCI_URL, params=params, timeout=8)
    response.raise_for_status()
    return response.json()


def _fetch_tps_mci_bbox(
    lat_min: float, lat_max: float, lon_min: float, lon_max: float, window_days: int
) -> dict:
    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=window_days)
    start_ms = int(start_dt.timestamp() * 1000)
    end_ms = int(end_dt.timestamp() * 1000)

    where = f"REPORT_DATE >= {start_ms} AND REPORT_DATE <= {end_ms}"
    params = {
        "f": "json",
        "where": where,
        "geometry": f"{lon_min},{lat_min},{lon_max},{lat_max}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "MCI_CATEGORY,REPORT_DATE,LAT_WGS84,LONG_WGS84",
        "resultRecordCount": 5000
    }
    response = requests.get(TPS_MCI_URL, params=params, timeout=8)
    response.raise_for_status()
    return response.json()


def crime_summary(lat: float, lon: float, radius_m: float, window_days: int):
    radius_km = radius_m / 1000
    cutoff_date = datetime.utcnow() - timedelta(days=window_days)

    lat_min, lat_max, lon_min, lon_max = get_bbox(lat, lon, radius_m)

    source_label = "Toronto Police Service MCI (live)"
    try:
        data = _fetch_tps_mci(lat, lon, radius_m, window_days)
        features = data.get("features", [])
        records = []
        for feature in features:
            attrs = feature.get("attributes", {})
            geom = feature.get("geometry", {})
            lat_val = attrs.get("LAT_WGS84") or geom.get("y")
            lon_val = attrs.get("LONG_WGS84") or geom.get("x")
            if lat_val is None or lon_val is None:
                continue
            records.append(
                {
                    "lat": float(lat_val),
                    "lon": float(lon_val),
                    "event_type": attrs.get("MCI_CATEGORY") or "Unknown",
                    "event_date": datetime.utcfromtimestamp(
                        (attrs.get("REPORT_DATE") or 0) / 1000
                    )
                }
            )
        df = pd.DataFrame.from_records(records)
    except Exception:
        if snowflake_configured():
            df = fetch_crime_events(lat_min, lat_max, lon_min, lon_max, cutoff_date.strftime("%Y-%m-%d"))
            df["event_date"] = pd.to_datetime(df["event_date"])
            source_label = "Snowflake: crime_events"
        else:
            df = pd.DataFrame()
            source_label = "Toronto Police Service MCI (unavailable)"

    if df.empty:
        return {
            "counts_by_type": {},
            "rate_hint": "unknown",
            "trend_hint": "unknown",
            "source": source_label,
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
        "source": source_label,
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


def _overpass_categories(categories: List[str]) -> List[Dict[str, str]]:
    mapping = {
        "grocery": {"key": "shop", "value": "supermarket"},
        "cafe": {"key": "amenity", "value": "cafe"},
        "library": {"key": "amenity", "value": "library"},
        "pharmacy": {"key": "amenity", "value": "pharmacy"}
    }
    tags = []
    for category in categories or []:
        tag = mapping.get(category)
        if tag:
            tags.append(tag)
    return tags


def nearby_pois(lat: float, lon: float, categories: List[str], radius_m: float):
    # Keep Overpass load low to avoid 429s.
    radius_m = max(100, min(radius_m, 800))
    categories = [cat for cat in categories if cat][:2]
    tags = _overpass_categories(categories)
    if not tags:
        return {"results": [], "counts_by_category": {}, "source": "Overpass API"}

    collection = _get_mongo_collection()
    cache_key = _cache_key(lat, lon, radius_m, categories)
    if collection:
        cached = collection.find_one({"key": cache_key})
        if cached and cached.get("value"):
            return {**cached["value"], "source": "Overpass API (cached)"}

    query_parts = []
    for tag in tags:
        tag_filter = f'[{tag["key"]}="{tag["value"]}"]'
        query_parts.append(f'node{tag_filter}(around:{int(radius_m)},{lat},{lon});')

    query = f"""
    [out:json][timeout:20];
    (
      {"".join(query_parts)}
    );
    out center 200;
    """

    response = requests.post(
        "https://overpass-api.de/api/interpreter",
        data=query,
        headers={"User-Agent": "Utrahacks-MVP/1.0 (student project)"},
        timeout=25
    )
    response.raise_for_status()
    data = response.json()
    elements = data.get("elements", [])

    results = []
    counts: Dict[str, int] = {}

    for element in elements:
        tags_obj = element.get("tags", {})
        name = tags_obj.get("name", "Unknown")
        lat_val = element.get("lat") or (element.get("center") or {}).get("lat")
        lon_val = element.get("lon") or (element.get("center") or {}).get("lon")
        if lat_val is None or lon_val is None:
            continue
        dist_km = haversine_km(lat, lon, float(lat_val), float(lon_val))
        if dist_km * 1000 > radius_m:
            continue
        category = "other"
        for key, value in (("shop", "supermarket"), ("amenity", "cafe"), ("amenity", "library"), ("amenity", "pharmacy")):
            if tags_obj.get(key) == value:
                category = {
                    ("shop", "supermarket"): "grocery",
                    ("amenity", "cafe"): "cafe",
                    ("amenity", "library"): "library",
                    ("amenity", "pharmacy"): "pharmacy"
                }[(key, value)]
                break

        results.append(
            {
                "name": name,
                "category": category,
                "dist_m": int(dist_km * 1000)
            }
        )
        counts[category] = counts.get(category, 0) + 1

    results = sorted(results, key=lambda item: item["dist_m"])[:25]
    payload = {
        "results": results,
        "counts_by_category": counts,
        "source": "Overpass API"
    }
    if collection:
        try:
            expires_at = datetime.utcnow() + timedelta(seconds=POI_CACHE_TTL_SEC)
            collection.update_one(
                {"key": cache_key},
                {"$set": {"key": cache_key, "value": payload, "expires_at": expires_at}},
                upsert=True
            )
        except PyMongoError:
            pass
    return payload


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

    if snowflake_configured():
        if not bounds:
            return {"type": "FeatureCollection", "features": [], "source": "rent-prices"}
        df = fetch_rent_prices(
            bounds["lat_min"],
            bounds["lat_max"],
            bounds["lon_min"],
            bounds["lon_max"],
            RENT_TABLE
        )
        df = df.rename(columns={"lat": "Lat", "lon": "Long", "price": "Price"})
    else:
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


def rent_points(bounds: Dict[str, float] | None, limit: int):
    if not bounds:
        return {"results": [], "source": "rent-prices"}

    if snowflake_configured():
        df = fetch_rent_prices(
            bounds["lat_min"],
            bounds["lat_max"],
            bounds["lon_min"],
            bounds["lon_max"],
            RENT_TABLE
        )
        df = df.rename(columns={"lat": "Lat", "lon": "Long", "price": "Price"})
    else:
        ensure_data_loaded()
        df = RENT_DF.copy()
        df = df[
            (df["Lat"] >= bounds["lat_min"])
            & (df["Lat"] <= bounds["lat_max"])
            & (df["Long"] >= bounds["lon_min"])
            & (df["Long"] <= bounds["lon_max"])
        ]

    if df.empty:
        return {"results": [], "source": "rent-prices"}

    df = df.dropna(subset=["Lat", "Long", "Price"])
    df = df.head(limit)
    results = []
    for _, row in df.iterrows():
        results.append(
            {
                "lat": float(row["Lat"]),
                "lon": float(row["Long"]),
                "price": str(row["Price"]),
                "bedroom": int(row.get("Bedroom", 0)),
                "bathroom": int(row.get("Bathroom", 0)),
                "den": int(row.get("Den", 0))
            }
        )
    return {"results": results, "source": "rent-prices"}


def crime_grid(bounds: Dict[str, float] | None, cell_km: float, min_count: int):
    if not bounds:
        return {"type": "FeatureCollection", "features": [], "source": "tps-mci"}

    lat_min = bounds["lat_min"]
    lat_max = bounds["lat_max"]
    lon_min = bounds["lon_min"]
    lon_max = bounds["lon_max"]
    center_lat = (lat_min + lat_max) / 2

    delta_lat = cell_km / 111.0
    delta_lon = cell_km / (111.0 * math.cos(math.radians(center_lat)))

    try:
        data = _fetch_tps_mci_bbox(lat_min, lat_max, lon_min, lon_max, 365)
        features = data.get("features", [])
        records = []
        for feature in features:
            attrs = feature.get("attributes", {})
            geom = feature.get("geometry", {})
            lat_val = attrs.get("LAT_WGS84") or geom.get("y")
            lon_val = attrs.get("LONG_WGS84") or geom.get("x")
            if lat_val is None or lon_val is None:
                continue
            records.append({"lat": float(lat_val), "lon": float(lon_val)})
        df = pd.DataFrame.from_records(records)
    except Exception:
        start_dt = datetime.utcnow() - timedelta(days=365)
        if snowflake_configured():
            df = fetch_crime_events(lat_min, lat_max, lon_min, lon_max, start_dt.strftime("%Y-%m-%d"))
            df = df.rename(columns={"lat": "lat", "lon": "lon"})
        else:
            df = pd.DataFrame()

    if df.empty:
        return {"type": "FeatureCollection", "features": [], "source": "tps-mci"}

    df["grid_x"] = ((df["lon"] - lon_min) / delta_lon).astype(int)
    df["grid_y"] = ((df["lat"] - lat_min) / delta_lat).astype(int)
    grouped = df.groupby(["grid_x", "grid_y"]).size().reset_index(name="count")

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
                    "count": int(row["count"])
                }
            }
        )
    return {"type": "FeatureCollection", "features": features, "source": "tps-mci"}


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
        elif tool == "crime_grid":
            bounds = args.get("bounds")
            data = crime_grid(
                bounds=bounds if isinstance(bounds, dict) else None,
                cell_km=float(args.get("cell_km", 1.0)),
                min_count=int(args.get("min_count", 3))
            )
        elif tool == "rent_points":
            bounds = args.get("bounds")
            data = rent_points(
                bounds=bounds if isinstance(bounds, dict) else None,
                limit=int(args.get("limit", 200))
            )
        else:
            return {"ok": False, "error": "Unknown tool"}

        return {"ok": True, "data": data}
    except Exception as exc:
        return {"ok": False, "error": str(exc)}
