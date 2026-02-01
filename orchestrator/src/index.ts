import "dotenv/config";
import express from "express";
import cors from "cors";
import { AnalyzeRequestSchema } from "./schemas.js";
import { callMcpTool } from "./mcpClient.js";
import { getCached, setCached } from "./cache.js";
import { getDb } from "./mongo.js";
import {
  normalizeWeights,
  runAmenitiesAgent,
  runAggregatorAgent,
  runSafetyAgent,
  runTransitAgent
} from "./agents.js";

const app = express();
const PORT = Number(process.env.ORCH_PORT ?? 4000);

app.use(cors());
app.use(express.json({ limit: "2mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get("/api/geocode", async (req, res) => {
  const query = String(req.query.query ?? "").trim();
  if (!query) {
    return res.status(400).json({ error: "Missing query" });
  }

  const latMin = req.query.lat_min ? Number(req.query.lat_min) : null;
  const latMax = req.query.lat_max ? Number(req.query.lat_max) : null;
  const lonMin = req.query.lon_min ? Number(req.query.lon_min) : null;
  const lonMax = req.query.lon_max ? Number(req.query.lon_max) : null;

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "5");
    url.searchParams.set("q", query);
    if (
      latMin !== null &&
      latMax !== null &&
      lonMin !== null &&
      lonMax !== null &&
      Number.isFinite(latMin) &&
      Number.isFinite(latMax) &&
      Number.isFinite(lonMin) &&
      Number.isFinite(lonMax)
    ) {
      url.searchParams.set("viewbox", `${lonMin},${latMax},${lonMax},${latMin}`);
      url.searchParams.set("bounded", "1");
    }

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "Utrahacks-MVP/1.0 (student project)"
      }
    });

    if (!response.ok) {
      return res.status(502).json({ error: "Geocode upstream failed" });
    }

    const data = (await response.json()) as Array<{ display_name: string; lat: string; lon: string }>;
    const results = data.map((item) => ({
      label: item.display_name,
      lat: Number(item.lat),
      lon: Number(item.lon)
    }));

    return res.json({ results });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/analyze", async (req, res) => {
  const parse = AnalyzeRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const { candidates, preferences } = parse.data;
  const weights = normalizeWeights(preferences.weights);
  const campus = { lat: 43.6629, lon: -79.3957 };

  try {
    const db = await getDb();
    const shortlistRecord = {
      candidates,
      preferences,
      createdAt: new Date()
    };
    await db.collection("shortlists").insertOne(shortlistRecord);

    const candidateMap = new Map(candidates.map((c) => [c.id, c]));
    const subAgentResults = [] as Array<{
      candidate_id: string;
      safety: any;
      transit: any;
      amenities: any;
    }>;

    for (const candidate of candidates) {
      const crimeParams = { radius_m: preferences.radius_m, window_days: preferences.window_days };
      const commuteParams = { campus_lat: campus.lat, campus_lon: campus.lon };
      const poiParams = { categories: preferences.poi_categories, radius_m: preferences.radius_m };

      const cachedCrime = await getCached("crime_summary", candidate.lat, candidate.lon, crimeParams);
      const crimeSummary =
        cachedCrime ??
        (await callMcpTool("crime_summary", {
          lat: candidate.lat,
          lon: candidate.lon,
          ...crimeParams
        }));
      if (!cachedCrime) {
        await setCached("crime_summary", candidate.lat, candidate.lon, crimeParams, crimeSummary);
      }

      const cachedCommute = await getCached("commute_proxy", candidate.lat, candidate.lon, commuteParams);
      const commuteProxy =
        cachedCommute ??
        (await callMcpTool("commute_proxy", {
          lat: candidate.lat,
          lon: candidate.lon,
          ...commuteParams
        }));
      if (!cachedCommute) {
        await setCached("commute_proxy", candidate.lat, candidate.lon, commuteParams, commuteProxy);
      }

      const cachedPois = await getCached("nearby_pois", candidate.lat, candidate.lon, poiParams);
      const nearbyPois =
        cachedPois ??
        (await callMcpTool("nearby_pois", {
          lat: candidate.lat,
          lon: candidate.lon,
          ...poiParams
        }));
      if (!cachedPois) {
        await setCached("nearby_pois", candidate.lat, candidate.lon, poiParams, nearbyPois);
      }

      const [safety, transit, amenities] = await Promise.all([
        runSafetyAgent({ candidate_id: candidate.id, crime_summary: crimeSummary }),
        runTransitAgent({ candidate_id: candidate.id, commute_proxy: commuteProxy }),
        runAmenitiesAgent({ candidate_id: candidate.id, nearby_pois: nearbyPois })
      ]);

      subAgentResults.push({ candidate_id: candidate.id, safety, transit, amenities });
    }

    const aggregatedCandidates = subAgentResults.map((result) => {
      const overall =
        result.safety.score_0_100 * weights.safety +
        result.transit.score_0_100 * weights.transit +
        result.amenities.score_0_100 * weights.amenities;

      return {
        candidate_id: result.candidate_id,
        overall_score_0_100: Number(overall.toFixed(2)),
        subscores: {
          safety: Math.round(result.safety.score_0_100),
          transit: Math.round(result.transit.score_0_100),
          amenities: Math.round(result.amenities.score_0_100)
        },
        pros: [...result.safety.pros, ...result.transit.pros, ...result.amenities.pros].slice(0, 6),
        cons: [...result.safety.cons, ...result.transit.cons, ...result.amenities.cons].slice(0, 6),
        evidence: [
          ...result.safety.evidence,
          ...result.transit.evidence,
          ...result.amenities.evidence
        ]
      };
    });

    const aggregatorPayload = {
      weights,
      candidates: aggregatedCandidates
    };

    const aggregatorOutput = await runAggregatorAgent(aggregatorPayload);

    const markers = aggregatorOutput.ranking.map((ranked, index) => {
      const candidate = candidateMap.get(ranked.candidate_id);
      if (!candidate) {
        throw new Error(`Unknown candidate ${ranked.candidate_id}`);
      }
      return {
        candidate_id: ranked.candidate_id,
        lat: candidate.lat,
        lon: candidate.lon,
        rank: index + 1
      };
    });

    let rentOverlay: unknown = null;
    try {
      const lats = [...candidates.map((c) => c.lat), campus.lat];
      const lons = [...candidates.map((c) => c.lon), campus.lon];
      const latMin = Math.min(...lats) - 0.02;
      const latMax = Math.max(...lats) + 0.02;
      const lonMin = Math.min(...lons) - 0.02;
      const lonMax = Math.max(...lons) + 0.02;
      const priceRange = preferences.price_range ?? { min: null, max: null };
      rentOverlay = await callMcpTool("rent_grid", {
        bounds: { lat_min: latMin, lat_max: latMax, lon_min: lonMin, lon_max: lonMax },
        cell_km: 0.8,
        min_count: 3,
        price_min: priceRange.min,
        price_max: priceRange.max
      });
    } catch (error) {
      rentOverlay = null;
    }

    const responsePayload = {
      ranking: aggregatorOutput.ranking,
      details: aggregatorOutput.details,
      map: {
        markers,
        overlays: { geojson: rentOverlay }
      }
    };

    await db.collection("analysis_runs").insertOne({
      request: parse.data,
      response: responsePayload,
      createdAt: new Date()
    });

    return res.json(responsePayload);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Orchestrator listening on ${PORT}`);
});
