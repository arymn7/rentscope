from __future__ import annotations

import argparse
import os
from pathlib import Path

import snowflake.connector


def main() -> None:
    parser = argparse.ArgumentParser(description="Upload synthetic rentals CSV to Snowflake.")
    parser.add_argument("--file", required=True, help="Path to CSV file")
    parser.add_argument("--table", default="RENTALS_SYNTH", help="Target table name")
    parser.add_argument("--stage", default="RENTALS_STAGE", help="Stage name")
    parser.add_argument("--create-warehouse", action="store_true", help="Create warehouse if missing")
    parser.add_argument("--create-db", action="store_true", help="Create database if missing")
    parser.add_argument("--create-schema", action="store_true", help="Create schema if missing")
    parser.add_argument("--warehouse", default=None, help="Warehouse name override")
    parser.add_argument("--database", default=None, help="Database name override")
    parser.add_argument("--schema", default=None, help="Schema name override")
    parser.add_argument("--warehouse-size", default="XSMALL", help="Warehouse size (XSMALL, SMALL, etc.)")
    args = parser.parse_args()

    account = os.getenv("SNOWFLAKE_ACCOUNT")
    user = os.getenv("SNOWFLAKE_USER")
    password = os.getenv("SNOWFLAKE_PASSWORD")
    warehouse = args.warehouse or os.getenv("SNOWFLAKE_WAREHOUSE")
    database = args.database or os.getenv("SNOWFLAKE_DATABASE")
    schema = args.schema or os.getenv("SNOWFLAKE_SCHEMA")
    role = os.getenv("SNOWFLAKE_ROLE")

    if not all([account, user, password, warehouse, database, schema]):
        raise SystemExit("Missing Snowflake env vars. Check SNOWFLAKE_ACCOUNT/USER/PASSWORD/WAREHOUSE/DATABASE/SCHEMA.")

    file_path = Path(args.file).expanduser().resolve()
    if not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")

    conn = snowflake.connector.connect(
        account=account,
        user=user,
        password=password,
        warehouse=warehouse,
        database=database,
        schema=schema,
        role=role
    )
    try:
        cursor = conn.cursor()
        if args.create_warehouse:
            cursor.execute(
                f"CREATE WAREHOUSE IF NOT EXISTS {warehouse} WAREHOUSE_SIZE = {args.warehouse_size}"
            )
        if args.create_db:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS {database}")
        if args.create_schema:
            cursor.execute(f"CREATE SCHEMA IF NOT EXISTS {database}.{schema}")
        cursor.execute(f"USE WAREHOUSE {warehouse}")
        cursor.execute(f"USE DATABASE {database}")
        cursor.execute(f"USE SCHEMA {schema}")
        cursor.execute(f"CREATE OR REPLACE STAGE {args.stage}")
        cursor.execute(
            f"""
            CREATE OR REPLACE TABLE {args.table} (
              bedroom NUMBER,
              bathroom NUMBER,
              den NUMBER,
              address STRING,
              lat FLOAT,
              lon FLOAT,
              price STRING,
              synthetic BOOLEAN
            )
            """
        )
        cursor.execute(
            f"PUT file://{file_path.as_posix()} @{args.stage} OVERWRITE=TRUE"
        )
        cursor.execute(
            f"""
            COPY INTO {args.table}
            FROM @{args.stage}/{file_path.name}
            FILE_FORMAT = (TYPE=CSV SKIP_HEADER=1 FIELD_OPTIONALLY_ENCLOSED_BY='\"')
            """
        )
        cursor.execute(f"SELECT COUNT(*) FROM {args.table}")
        print(f"Rows loaded: {cursor.fetchone()[0]}")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
