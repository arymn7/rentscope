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
  runAreaRanking,
  runAreaSummary,
  runSafetyAgent,
  runTransitAgent,
  runWhatIfSummary
} from "./agents.js";
import { WhatIfRequestSchema } from "./schemas.js";

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

  try {
    const result = await runFullAnalysis(
      parse.data.candidates,
      parse.data.preferences,
      parse.data.map_bounds
    );
    const db = await getDb();
    await db.collection("analysis_runs").insertOne({
      request: parse.data,
      response: result,
      createdAt: new Date()
    });
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.get("/api/rent_points", async (req, res) => {
  const latMin = Number(req.query.lat_min);
  const latMax = Number(req.query.lat_max);
  const lonMin = Number(req.query.lon_min);
  const lonMax = Number(req.query.lon_max);
  const limit = req.query.limit ? Number(req.query.limit) : 200;

  if (![latMin, latMax, lonMin, lonMax].every((v) => Number.isFinite(v))) {
    return res.status(400).json({ error: "lat_min/lat_max/lon_min/lon_max required" });
  }

  try {
    const data = await callMcpTool("rent_points", {
      bounds: { lat_min: latMin, lat_max: latMax, lon_min: lonMin, lon_max: lonMax },
      limit
    });
    return res.json(data);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function adjustPreferences(
  preferences: {
    weights: { safety: number; transit: number; amenities: number };
    radius_m: number;
    window_days: number;
    poi_categories: string[];
    price_range?: { min: number | null; max: number | null };
  },
  whatIf: { budget_delta: number; commute_delta_min: number }
) {
  const updated = { ...preferences };
  if (updated.price_range) {
    updated.price_range = {
      min: updated.price_range.min !== null ? updated.price_range.min + whatIf.budget_delta : null,
      max: updated.price_range.max !== null ? updated.price_range.max + whatIf.budget_delta : null
    };
  }

  const deltaFactor = clamp(-whatIf.commute_delta_min / 30, -1, 1) * 0.2;
  const weights = {
    safety: updated.weights.safety,
    transit: clamp(updated.weights.transit + deltaFactor, 0.05, 0.9),
    amenities: updated.weights.amenities
  };
  const total = weights.safety + weights.transit + weights.amenities;
  updated.weights = {
    safety: weights.safety / total,
    transit: weights.transit / total,
    amenities: weights.amenities / total
  };
  return updated;
}

async function runFullAnalysis(
  candidates: Array<{ id: string; label: string; lat: number; lon: number }>,
  preferences: {
    weights: { safety: number; transit: number; amenities: number };
    radius_m: number;
    window_days: number;
    poi_categories: string[];
    price_range?: { min: number | null; max: number | null };
  },
  map_bounds?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number }
) {
  const weights = normalizeWeights(preferences.weights);
  const campus = { lat: 43.6629, lon: -79.3957 };
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
  const lats = [...candidates.map((c) => c.lat), campus.lat];
  const lons = [...candidates.map((c) => c.lon), campus.lon];
  const latMin = map_bounds?.lat_min ?? Math.min(...lats) - 0.02;
  const latMax = map_bounds?.lat_max ?? Math.max(...lats) + 0.02;
  const lonMin = map_bounds?.lon_min ?? Math.min(...lons) - 0.02;
  const lonMax = map_bounds?.lon_max ?? Math.max(...lons) + 0.02;
  const priceRange = preferences.price_range ?? { min: null, max: null };

  try {
    rentOverlay = await callMcpTool("rent_grid", {
      bounds: { lat_min: latMin, lat_max: latMax, lon_min: lonMin, lon_max: lonMax },
      cell_km: 0.8,
      min_count: 1,
      price_min: priceRange.min,
      price_max: priceRange.max
    });
  } catch {
    rentOverlay = null;
  }

  const rentFeatures =
    (rentOverlay as { features?: Array<any> } | null)?.features?.filter(Boolean) ?? [];
  const areaCandidates = rentFeatures
    .map((feature) => {
      const props = feature.properties ?? {};
      const coords = feature.geometry?.coordinates?.[0] ?? [];
      if (!coords.length) return null;
      const sum = coords.reduce(
        (acc: number[], item: number[]) => [acc[0] + item[1], acc[1] + item[0]],
        [0, 0]
      );
      const center = { lat: sum[0] / coords.length, lon: sum[1] / coords.length };
      return {
        area_id: String(props.cell_id ?? `${center.lat}-${center.lon}`),
        label: props.cell_id ? `Grid ${props.cell_id}` : "Grid area",
        center,
        avg_price: Number(props.avg_price ?? 0),
        count: Number(props.count ?? 0)
      };
    })
    .filter(Boolean)
    .sort((a: any, b: any) => b.count - a.count)
    .slice(0, 12) as Array<{
    area_id: string;
    label: string;
    center: { lat: number; lon: number };
    avg_price: number;
    count: number;
  }>;

  if (!areaCandidates.length) {
    return {
      ranking: aggregatorOutput.ranking,
      details: aggregatorOutput.details,
      map: {
        markers,
        overlays: { rent_geojson: rentOverlay, crime_geojson: null }
      }
    };
  }

  const areasPayload = [];
  for (const area of areaCandidates) {
    const crimeSummary = await callMcpTool("crime_summary", {
      lat: area.center.lat,
      lon: area.center.lon,
      radius_m: preferences.radius_m,
      window_days: preferences.window_days
    });

    const poiSummary = await callMcpTool("nearby_pois", {
      lat: area.center.lat,
      lon: area.center.lon,
      categories: preferences.poi_categories,
      radius_m: preferences.radius_m
    });

    const commuteSamples = await Promise.all(
      candidates.map((anchor) =>
        callMcpTool("commute_proxy", {
          lat: area.center.lat,
          lon: area.center.lon,
          campus_lat: anchor.lat,
          campus_lon: anchor.lon
        })
      )
    );
    const commuteMinutes =
      commuteSamples.reduce((sum: number, item: any) => sum + Number(item.est_minutes ?? 0), 0) /
      Math.max(commuteSamples.length, 1);

    const incidentCount = Object.values(crimeSummary?.counts_by_type ?? {}).reduce(
      (sum: number, value: any) => sum + Number(value ?? 0),
      0
    );
    const poiCount = Object.values(poiSummary?.counts_by_category ?? {}).reduce(
      (sum: number, value: any) => sum + Number(value ?? 0),
      0
    );

    const affordabilityScore =
      priceRange.max && area.avg_price
        ? Math.max(10, Math.min(100, 100 - (area.avg_price / priceRange.max) * 80))
        : 60;
    const safetyScore = Math.max(10, 100 - Math.min(incidentCount * 6, 80));
    const transitScore = Math.max(10, 100 - Math.min(commuteMinutes * 2, 80));
    const amenitiesScore = Math.max(10, Math.min(poiCount * 8, 100));

    areasPayload.push({
      area_id: area.area_id,
      label: area.label,
      center: area.center,
      subscores: {
        affordability: Math.round(affordabilityScore),
        safety: Math.round(safetyScore),
        transit: Math.round(transitScore),
        amenities: Math.round(amenitiesScore)
      },
      evidence: [
        { metric: "Avg rent", value: String(area.avg_price), source: "Rent data" },
        { metric: "Listing count", value: String(area.count), source: "Listing data" },
        { metric: "Incident count", value: String(incidentCount), source: crimeSummary?.source ?? "TPS MCI" },
        { metric: "Avg commute (min)", value: String(Math.round(commuteMinutes)), source: "MCP commute_proxy" },
        { metric: "Amenities count", value: String(poiCount), source: poiSummary?.source ?? "Overpass API" }
      ]
    });
  }

  const areaRanking = await runAreaRanking({
    weights,
    areas: areasPayload
  });

  const areaMarkers = areaRanking.ranking.slice(0, 6).map((area, index) => {
    const detail = areaRanking.details[area.area_id];
    return {
      candidate_id: area.area_id,
      lat: detail.center.lat,
      lon: detail.center.lon,
      rank: index + 1
    };
  });

  return {
    ranking: areaRanking.ranking.map((item) => ({
      candidate_id: item.area_id,
      label: item.label,
      overall_score_0_100: item.overall_score_0_100,
      summary: item.summary,
      key_tradeoffs: item.key_tradeoffs
    })),
    details: areaRanking.details,
    map: {
      markers: areaMarkers,
      overlays: { rent_geojson: rentOverlay, crime_geojson: null }
    }
  };
}

app.post("/api/what_if", async (req, res) => {
  const parse = WhatIfRequestSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: parse.error.flatten() });
  }

  const { candidates, preferences, what_if, map_bounds } = parse.data;

  try {
    const baseline = await runFullAnalysis(candidates, preferences, map_bounds);
    const adjustedPrefs = adjustPreferences(preferences, what_if);
    const scenario = await runFullAnalysis(candidates, adjustedPrefs, map_bounds);

    const summaryPayload = {
      budget_delta: what_if.budget_delta,
      commute_delta_min: what_if.commute_delta_min,
      baseline_ranking: baseline.ranking,
      what_if_ranking: scenario.ranking
    };
    const summary = await runWhatIfSummary(summaryPayload);

    return res.json({
      baseline: { ranking: baseline.ranking },
      what_if: { ranking: scenario.ranking },
      summary
    });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.post("/api/area_summary", async (req, res) => {
  const { lat, lon, label } = req.body ?? {};
  if (typeof lat !== "number" || typeof lon !== "number") {
    return res.status(400).json({ error: "lat/lon required" });
  }
  try {
    const crimeParams = { radius_m: 600, window_days: 365 };
    const poiParams = { categories: ["grocery", "cafe"], radius_m: 600 };

    const cachedCrime = await getCached("crime_summary", lat, lon, crimeParams);
    const crimeSummary =
      cachedCrime ??
      (await callMcpTool("crime_summary", {
        lat,
        lon,
        ...crimeParams
      }));
    if (!cachedCrime) {
      await setCached("crime_summary", lat, lon, crimeParams, crimeSummary);
    }

    const cachedPois = await getCached("nearby_pois", lat, lon, poiParams);
    const nearbyPois =
      cachedPois ??
      (await callMcpTool("nearby_pois", {
        lat,
        lon,
        ...poiParams
      }));
    if (!cachedPois) {
      await setCached("nearby_pois", lat, lon, poiParams, nearbyPois);
    }

    const payload = {
      label: label ?? "Selected area",
      crime_summary: crimeSummary,
      nearby_amenities: nearbyPois
    };
    const summary = await runAreaSummary(payload);
    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`Orchestrator listening on ${PORT}`);
});
