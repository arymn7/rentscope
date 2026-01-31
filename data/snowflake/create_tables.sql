-- Snowflake schema for Toronto Student Housing Map Assistant
CREATE OR REPLACE TABLE crime_events (
  event_type STRING,
  event_date DATE,
  lat FLOAT,
  lon FLOAT
);

CREATE OR REPLACE TABLE ttc_stops (
  stop_id STRING,
  stop_name STRING,
  lat FLOAT,
  lon FLOAT,
  mode STRING
);

CREATE OR REPLACE TABLE neighbourhood_boundaries (
  neighbourhood_id STRING,
  name STRING,
  geojson VARIANT
);
