# Toronto Student Housing Map Assistant (MCP-based, multi-agent)

Hackathon-ready MVP monorepo for a ranked housing shortlist assistant. Students add candidate locations, then multi-agent reasoning (Gemini) ranks options using MCP tools that access data. Frontend never touches Snowflake/TTC/TPS directly.

## Repo Structure
- `frontend/` — Next.js + Tailwind + Leaflet
- `orchestrator/` — Node.js API + Gemini agent manager
- `mcp_server/` — Python FastAPI MCP server + tools
- `data/` — sample datasets + Snowflake SQL scripts

## Architecture Rules (enforced)
- Frontend -> Orchestrator only
- Orchestrator -> MCP tools only (no Snowflake direct)
- Agents only interpret MCP tool outputs (JSON-only, validated)
- MongoDB stores shortlists, tool cache, and analysis runs

## Data Sources (public)
- Toronto Police Service Open Data (Major Crime Indicators / Public Safety Data Portal):
  - https://www.tps.ca/data-maps/open-data/
  - ArcGIS Feature Service (Major Crime Indicators open data):
    https://services.arcgis.com/S9th0jAJ7bqgIRjw/arcgis/rest/services/Major_Crime_Indicators_Open_Data/FeatureServer/0
- TTC GTFS (routes/stops/schedules):
  - https://data.urbandatacentre.ca/catalogue/city-toronto-ttc-routes-and-schedules
- OpenStreetMap / Overpass API (optional for POIs):
  - https://wiki.openstreetmap.org/wiki/Overpass_API

## Quickstart (Docker)
1) Create an environment variable with your Gemini key (PowerShell):
```powershell
$env:GEMINI_API_KEY="your_key_here"
```
2) Run the stack:
```bash
docker compose up --build
```
3) Open the app: `http://localhost:3000`

## Local Dev (without Docker)
### MCP Server
```powershell
cd mcp_server
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app:app --reload --port 7000
```

### Orchestrator
```powershell
cd orchestrator
npm install
$env:MCP_URL="http://localhost:7000"
$env:MONGO_URI="mongodb://localhost:27017"
$env:GEMINI_API_KEY="your_key_here"
npm run dev
```

### Frontend
```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_ORCHESTRATOR_URL="http://localhost:4000"
npm run dev
```

## Demo Script
Use the built-in demo shortlist button in the UI, or call the API directly:
```bash
curl -X POST http://localhost:4000/api/analyze \
  -H "Content-Type: application/json" \
  -d @data/sample/seed_demo.json
```

Optional: seed MongoDB with the same demo shortlist:
```powershell
pip install pymongo
python data/seed_mongo.py
```

## MCP Tools (JSON I/O)
- `crime_summary(lat, lon, radius_m, window_days)`
  - returns `{counts_by_type, rate_hint, trend_hint, source, updated_at}`
- `commute_proxy(lat, lon, campus_lat, campus_lon)`
  - returns `{distance_km, est_minutes, near_transit_hint, source}`
- `nearby_pois(lat, lon, categories, radius_m)`
  - returns `{results:[{name, category, dist_m}], counts_by_category, source}`

## Snowflake Setup
SQL scripts live in `data/snowflake/`:
- `create_tables.sql`
- `load_sample.sql`

Set these env vars for Snowflake access (MCP server):
```
SNOWFLAKE_ACCOUNT
SNOWFLAKE_USER
SNOWFLAKE_PASSWORD
SNOWFLAKE_WAREHOUSE
SNOWFLAKE_DATABASE
SNOWFLAKE_SCHEMA
SNOWFLAKE_ROLE (optional)
```

## MongoDB Collections
- `shortlists`
- `analysis_cache`
- `analysis_runs`

## Notes & Safety
- This MVP reports “higher/lower incident density” based on available open data only.
- Crime locations in the demo data are approximate; treat results as indicative.
- Agent outputs are validated JSON with retries; deterministic fallbacks run if Gemini is unavailable.
