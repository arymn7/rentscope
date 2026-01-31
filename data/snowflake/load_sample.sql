-- Example loading script for Snowflake (adjust file paths as needed)
-- 1) Create a file format
CREATE OR REPLACE FILE FORMAT csv_format
  TYPE = 'CSV'
  FIELD_OPTIONALLY_ENCLOSED_BY = '"'
  SKIP_HEADER = 1;

-- 2) Create an internal stage
CREATE OR REPLACE STAGE utrahacks_stage FILE_FORMAT = csv_format;

-- 3) Upload files from local machine (run in SnowSQL or UI)
-- PUT file://<ABS_PATH>/crime_events.csv @utrahacks_stage AUTO_COMPRESS=TRUE;
-- PUT file://<ABS_PATH>/ttc_stops.csv @utrahacks_stage AUTO_COMPRESS=TRUE;

-- 4) Copy into tables
COPY INTO crime_events
FROM @utrahacks_stage/crime_events.csv
FILE_FORMAT = (FORMAT_NAME = csv_format)
ON_ERROR = 'CONTINUE';

COPY INTO ttc_stops
FROM @utrahacks_stage/ttc_stops.csv
FILE_FORMAT = (FORMAT_NAME = csv_format)
ON_ERROR = 'CONTINUE';
