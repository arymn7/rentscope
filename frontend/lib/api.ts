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

export async function geocode(query: string) {
  const response = await fetch(`${ORCH_URL}/api/geocode?query=${encodeURIComponent(query)}`);
  if (!response.ok) {
    throw new Error("Failed to geocode");
  }
  return response.json() as Promise<{ results: Array<{ label: string; lat: number; lon: number }> }>;
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
