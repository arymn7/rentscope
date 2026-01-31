import os
import pandas as pd
import snowflake.connector

REQUIRED_ENV = [
    "SNOWFLAKE_ACCOUNT",
    "SNOWFLAKE_USER",
    "SNOWFLAKE_PASSWORD",
    "SNOWFLAKE_WAREHOUSE",
    "SNOWFLAKE_DATABASE",
    "SNOWFLAKE_SCHEMA"
]


def snowflake_configured() -> bool:
    return all(os.getenv(key) for key in REQUIRED_ENV)


def get_connection():
    return snowflake.connector.connect(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA"),
        role=os.getenv("SNOWFLAKE_ROLE")
    )


def query_dataframe(sql: str, params: dict) -> pd.DataFrame:
    with get_connection() as conn:
        return pd.read_sql(sql, conn, params=params)


def fetch_crime_events(lat_min: float, lat_max: float, lon_min: float, lon_max: float, cutoff_date: str) -> pd.DataFrame:
    sql = """
        SELECT event_type, event_date, lat, lon
        FROM crime_events
        WHERE lat BETWEEN %(lat_min)s AND %(lat_max)s
          AND lon BETWEEN %(lon_min)s AND %(lon_max)s
          AND event_date >= %(cutoff_date)s
    """
    return query_dataframe(sql, {
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max,
        "cutoff_date": cutoff_date
    })


def fetch_ttc_stops(lat_min: float, lat_max: float, lon_min: float, lon_max: float) -> pd.DataFrame:
    sql = """
        SELECT stop_id, stop_name, lat, lon, mode
        FROM ttc_stops
        WHERE lat BETWEEN %(lat_min)s AND %(lat_max)s
          AND lon BETWEEN %(lon_min)s AND %(lon_max)s
    """
    return query_dataframe(sql, {
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max
    })
