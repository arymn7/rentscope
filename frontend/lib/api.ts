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
    overall_score_0_100: number;
    summary: string;
    key_tradeoffs: string[];
  }>;
  details: Record<
    string,
    {
      subscores: { safety: number; transit: number; amenities: number };
      pros: string[];
      cons: string[];
      evidence: Array<{ metric: string; value: string; source: string }>;
    }
  >;
  map: {
    markers: Array<{ candidate_id: string; lat: number; lon: number; rank: number }>;
    overlays?: { geojson?: GeoJSON.GeoJsonObject | null };
  };
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
