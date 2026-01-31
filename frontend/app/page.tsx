"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import type { Candidate as MapCandidate } from "../components/MapView";
import { analyze, geocode, type AnalyzeResponse } from "../lib/api";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

const CAMPUS = {
  lat: 43.6629,
  lon: -79.3957,
  label: "UofT St. George Campus"
};

const DEMO_CANDIDATES: MapCandidate[] = [
  { id: "cand1", label: "Annex - Bloor St W", lat: 43.6684, lon: -79.4031 },
  { id: "cand2", label: "Kensington Market", lat: 43.6543, lon: -79.4006 },
  { id: "cand3", label: "Leslieville", lat: 43.6626, lon: -79.3369 }
];

export default function HomePage() {
  const [candidates, setCandidates] = useState<MapCandidate[]>([]);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<
    Array<{ label: string; lat: number; lon: number }>
  >([]);
  const [preferences, setPreferences] = useState({
    weights: { safety: 0.4, transit: 0.4, amenities: 0.2 },
    radius_m: 1000,
    window_days: 30,
    poi_categories: ["grocery", "cafe", "library"]
  });
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mapCenter = useMemo(() => [43.664, -79.391] as [number, number], []);

  function addCandidate(lat: number, lon: number, label = "Pinned location") {
    const id = `cand-${Date.now()}`;
    setCandidates((prev) => [...prev, { id, label, lat, lon }]);
  }

  function removeCandidate(id: string) {
    setCandidates((prev) => prev.filter((candidate) => candidate.id !== id));
  }

  async function handleSearch() {
    if (!query.trim()) return;
    setError(null);
    try {
      const result = await geocode(query.trim());
      setSearchResults(result.results);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function handleAnalyze() {
    if (candidates.length === 0) {
      setError("Add at least one candidate location.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await analyze({
        candidates: candidates.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
        preferences
      });
      setAnalysis(response);
      const ranked = response.map.markers.reduce<Record<string, number>>((acc, marker) => {
        acc[marker.candidate_id] = marker.rank;
        return acc;
      }, {});
      setCandidates((prev) =>
        prev.map((candidate) => ({
          ...candidate,
          rank: ranked[candidate.id]
        }))
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mesh px-6 py-8 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
          <p className="text-sm uppercase tracking-[0.2em] text-ink/60">Hackathon MVP</p>
          <h1 className="mt-2 font-display text-3xl md:text-4xl">
            Toronto Student Housing Map Assistant
          </h1>
          <p className="mt-2 max-w-2xl text-base text-ink/70">
            Add 2–5 candidate addresses and get a ranked recommendation powered by MCP tools and
            Gemini multi-agent reasoning. All safety/transit/amenity signals come from the
            available open data sources.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl bg-white p-4 shadow-soft">
            <div className="flex h-[520px] flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  className="rounded-full border border-ink/10 bg-ink px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5"
                  onClick={() => {
                    setCandidates(DEMO_CANDIDATES);
                    setAnalysis(null);
                  }}
                >
                  Load demo shortlist
                </button>
                <span className="text-xs text-ink/60">
                  Tip: click the map to drop more candidates.
                </span>
              </div>
              <div className="relative flex-1 overflow-hidden rounded-2xl">
                <MapView
                  center={mapCenter}
                  candidates={candidates}
                  campus={CAMPUS}
                  overlay={analysis?.map.overlays?.geojson ?? null}
                  onAdd={(lat, lon) => addCandidate(lat, lon, "Pinned from map")}
                />
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-soft">
            <div>
              <h2 className="font-display text-xl">Shortlist & Preferences</h2>
              <p className="text-sm text-ink/60">
                Frontend only talks to the orchestrator API — MCP tools handle data access.
              </p>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <div className="flex flex-col gap-3">
                <div className="flex gap-2">
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search address (Nominatim via orchestrator)"
                    className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleSearch}
                    className="rounded-xl bg-accent px-4 py-2 text-sm font-semibold text-white"
                  >
                    Search
                  </button>
                </div>
                {searchResults.length > 0 ? (
                  <div className="max-h-36 overflow-auto rounded-xl border border-ink/10 bg-ink/5 p-2 text-xs">
                    {searchResults.map((result) => (
                      <button
                        key={`${result.lat}-${result.lon}`}
                        onClick={() => {
                          addCandidate(result.lat, result.lon, result.label);
                          setSearchResults([]);
                        }}
                        className="block w-full rounded-lg px-2 py-1 text-left hover:bg-white"
                      >
                        {result.label}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Candidates</h3>
                <span className="text-xs text-ink/50">{candidates.length} added</span>
              </div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {candidates.length === 0 ? (
                  <p className="text-xs text-ink/60">No candidates yet. Click the map to add.</p>
                ) : (
                  candidates.map((candidate) => (
                    <div
                      key={candidate.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2"
                    >
                      <div>
                        <div className="font-semibold">
                          {candidate.rank ? `#${candidate.rank} · ` : ""}
                          {candidate.label}
                        </div>
                        <div className="text-xs text-ink/50">
                          {candidate.lat.toFixed(4)}, {candidate.lon.toFixed(4)}
                        </div>
                      </div>
                      <button
                        onClick={() => removeCandidate(candidate.id)}
                        className="rounded-full border border-ink/10 px-2 py-1 text-xs"
                      >
                        Remove
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <h3 className="text-sm font-semibold">Weights</h3>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                {(["safety", "transit", "amenities"] as const).map((key) => (
                  <label key={key} className="flex flex-col gap-1">
                    <span className="uppercase text-ink/50">{key}</span>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.1}
                      value={preferences.weights[key]}
                      onChange={(event) =>
                        setPreferences((prev) => ({
                          ...prev,
                          weights: { ...prev.weights, [key]: Number(event.target.value) }
                        }))
                      }
                      className="rounded-lg border border-ink/10 px-2 py-1"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Radius (m)</span>
                  <input
                    type="number"
                    value={preferences.radius_m}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        radius_m: Number(event.target.value)
                      }))
                    }
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Window (days)</span>
                  <input
                    type="number"
                    value={preferences.window_days}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        window_days: Number(event.target.value)
                      }))
                    }
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
              </div>
              <div className="mt-3 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">POI Categories</span>
                  <input
                    value={preferences.poi_categories.join(", ")}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        poi_categories: event.target.value
                          .split(",")
                          .map((entry) => entry.trim())
                          .filter(Boolean)
                      }))
                    }
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
              </div>
            </div>

            <button
              onClick={handleAnalyze}
              disabled={loading}
              className="rounded-2xl bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:opacity-60"
            >
              {loading ? "Analyzing..." : "Analyze shortlist"}
            </button>

            {error ? <div className="text-sm text-red-600">{error}</div> : null}
          </section>
        </div>

        <section className="rounded-3xl bg-white p-6 shadow-soft">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl">Ranked Recommendations</h2>
            <span className="rounded-full bg-ink/5 px-3 py-1 text-xs text-ink/70">
              Disclaimer: higher/lower incident density is based on available data only.
            </span>
          </div>

          {analysis ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {analysis.ranking.map((item) => {
                const details = analysis.details[item.candidate_id];
                if (!details) return null;
                return (
                  <div key={item.candidate_id} className="rounded-2xl border border-ink/10 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">{item.candidate_id}</h3>
                      <span className="text-sm font-semibold text-accent">
                        {item.overall_score_0_100.toFixed(1)} / 100
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink/70">{item.summary}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      <div className="rounded-lg bg-ink/5 p-2">Safety: {details.subscores.safety}</div>
                      <div className="rounded-lg bg-ink/5 p-2">Transit: {details.subscores.transit}</div>
                      <div className="rounded-lg bg-ink/5 p-2">
                        Amenities: {details.subscores.amenities}
                      </div>
                    </div>
                    <div className="mt-3 text-xs text-ink/70">
                      <strong>Tradeoffs:</strong> {item.key_tradeoffs.join("; ")}
                    </div>
                    <div className="mt-3 text-xs">
                      <strong>Evidence:</strong>
                      <ul className="mt-1 list-disc pl-4">
                        {details.evidence.map((entry, index) => (
                          <li key={`${item.candidate_id}-e-${index}`}>
                            {entry.metric}: {entry.value} ({entry.source})
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 text-sm text-ink/60">
              Run the analysis to see ranked recommendations, scores, and agent reasoning.
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
