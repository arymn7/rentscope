export const ORCH_URL =
  process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? "http://localhost:4000";

export type Candidate = {
  id: string;
  label: string;
  lat: number;
  lon: number;
};

export type AnalyzeRequest = {
  candidates: Candidate[];
  map_bounds?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
  preferences: {
    weights: { safety: number; transit: number; amenities: number };
    radius_m: number;
    window_days: number;
    poi_categories: string[];
    price_range?: { min: number | null; max: number | null };
  };
};

export type AnalyzeResponse = {
  ranking: Array<{
    candidate_id: string;
    label?: string;
    overall_score_0_100: number;
    summary: string;
    key_tradeoffs: string[];
  }>;
  details: Record<
    string,
    {
      label?: string;
      center?: { lat: number; lon: number };
      subscores:
        | { safety: number; transit: number; amenities: number }
        | { affordability: number; safety: number; transit: number; amenities: number };
      pros: string[];
      cons: string[];
      evidence: Array<{ metric: string; value: string; source: string }>;
    }
  >;
  map: {
    markers: Array<{ candidate_id: string; lat: number; lon: number; rank: number }>;
    overlays?: {
      rent_geojson?: GeoJSON.GeoJsonObject | null;
      crime_geojson?: GeoJSON.GeoJsonObject | null;
    };
  };
};

export type WhatIfRequest = AnalyzeRequest & {
  what_if: { budget_delta: number; commute_delta_min: number };
};

export type WhatIfResponse = {
  baseline: { ranking: AnalyzeResponse["ranking"] };
  what_if: { ranking: AnalyzeResponse["ranking"] };
  summary: { summary: string; key_changes: string[] };
};

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

export async function geocode(
  query: string,
  bounds?: { latMin: number; latMax: number; lonMin: number; lonMax: number }
) {
  if (!MAPBOX_TOKEN) {
    throw new Error("Missing Mapbox token.");
  }
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json`
  );
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  url.searchParams.set("autocomplete", "true");
  url.searchParams.set("limit", "6");
  if (bounds) {
    url.searchParams.set(
      "bbox",
      `${bounds.lonMin},${bounds.latMin},${bounds.lonMax},${bounds.latMax}`
    );
  }
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to geocode");
  }
  const data = (await response.json()) as {
    features: Array<{ place_name: string; center: [number, number] }>;
  };
  return {
    results: data.features.map((feature) => ({
      label: feature.place_name,
      lat: feature.center[1],
      lon: feature.center[0]
    }))
  };
}

export async function reverseGeocode(lat: number, lon: number) {
  if (!MAPBOX_TOKEN) {
    throw new Error("Missing Mapbox token.");
  }
  const url = new URL(
    `https://api.mapbox.com/geocoding/v5/mapbox.places/${lon},${lat}.json`
  );
  url.searchParams.set("access_token", MAPBOX_TOKEN);
  url.searchParams.set("limit", "1");
  const response = await fetch(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Failed to reverse geocode");
  }
  const data = (await response.json()) as {
    features: Array<{ place_name: string }>;
  };
  return data.features[0]?.place_name ?? "Selected area";
}

export async function analyze(payload: AnalyzeRequest) {
  const response = await fetch(`${ORCH_URL}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Analyze failed");
  }
  return response.json() as Promise<AnalyzeResponse>;
}

export async function whatIf(payload: WhatIfRequest) {
  const response = await fetch(`${ORCH_URL}/api/what_if`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "What-if failed");
  }
  return response.json() as Promise<WhatIfResponse>;
}

export async function areaSummary(payload: { lat: number; lon: number; label?: string }) {
  const response = await fetch(`${ORCH_URL}/api/area_summary`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Area summary failed");
  }
  const data = (await response.json()) as any;
  if (data?.summary?.summary && Array.isArray(data.summary.amenities)) {
    return data.summary;
  }
  if (data?.summary && typeof data.summary === "object" && typeof data.summary.summary === "string") {
    return data.summary;
  }
  if (typeof data?.summary === "string") {
    return { summary: data.summary, amenities: [], highlights: [] };
  }
  if (typeof data?.summary?.summary === "string") {
    return data.summary;
  }
  return { summary: "Summary unavailable due to missing data.", amenities: [], highlights: [] };
}
