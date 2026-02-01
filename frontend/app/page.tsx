"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Candidate as MapCandidate } from "../components/MapView";
import { analyze, geocode, type AnalyzeResponse } from "../lib/api";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

type AnchorType = "School" | "Work" | "Other";

type Anchor = MapCandidate & { kind: AnchorType };

export default function HomePage() {
  const [school, setSchool] = useState<Anchor | null>(null);
  const [anchors, setAnchors] = useState<Anchor[]>([]);
  const [schoolQuery, setSchoolQuery] = useState("");
  const [schoolResults, setSchoolResults] = useState<
    Array<{ label: string; lat: number; lon: number }>
  >([]);
  const [schoolLoading, setSchoolLoading] = useState(false);
  const [schoolHighlight, setSchoolHighlight] = useState(0);
  const [placeQuery, setPlaceQuery] = useState("");
  const [placeResults, setPlaceResults] = useState<
    Array<{ label: string; lat: number; lon: number }>
  >([]);
  const [placeLoading, setPlaceLoading] = useState(false);
  const [placeHighlight, setPlaceHighlight] = useState(0);
  const [placeKind, setPlaceKind] = useState<AnchorType>("Work");
  const [preferences, setPreferences] = useState({
    weights: { safety: 0.4, transit: 0.4, amenities: 0.2 },
    radius_m: 1000,
    window_days: 30,
    poi_categories: ["grocery", "cafe", "library"],
    price_range: { min: 1600, max: 2600 }
  });
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mapBounds, setMapBounds] = useState<{
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    cellId: string;
    avgPrice: number;
    count: number;
  } | null>(null);

  const mapCenter = useMemo(() => [43.664, -79.391] as [number, number], []);

  useEffect(() => {
    if (schoolQuery.trim().length < 2) {
      setSchoolResults([]);
      setSchoolLoading(false);
      setSchoolHighlight(0);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        setError(null);
        setSchoolLoading(true);
        const results = await geocode(schoolQuery.trim(), mapBounds ?? undefined);
        if (!controller.signal.aborted) {
          setSchoolResults(results.results);
          setSchoolLoading(false);
          setSchoolHighlight(0);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message);
          setSchoolLoading(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [schoolQuery, mapBounds]);

  useEffect(() => {
    if (placeQuery.trim().length < 2) {
      setPlaceResults([]);
      setPlaceLoading(false);
      setPlaceHighlight(0);
      return;
    }
    const controller = new AbortController();
    const handle = setTimeout(async () => {
      try {
        setError(null);
        setPlaceLoading(true);
        const results = await geocode(placeQuery.trim(), mapBounds ?? undefined);
        if (!controller.signal.aborted) {
          setPlaceResults(results.results);
          setPlaceLoading(false);
          setPlaceHighlight(0);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          setError((err as Error).message);
          setPlaceLoading(false);
        }
      }
    }, 250);
    return () => {
      controller.abort();
      clearTimeout(handle);
    };
  }, [placeQuery, mapBounds]);

  const heatmapScale = useMemo(() => {
    const overlay = analysis?.map.overlays?.geojson;
    if (!overlay || !("features" in overlay)) return null;
    const features = (overlay as GeoJSON.FeatureCollection).features ?? [];
    const prices = features
      .map((feature) => (feature.properties as { avg_price?: number } | undefined)?.avg_price)
      .filter((value): value is number => typeof value === "number");
    if (prices.length === 0) return null;
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const steps = 5;
    const palette = ["#fef0d9", "#fdd49e", "#fdbb84", "#fc8d59", "#d7301f"];
    const stops = palette.map((color, index) => ({
      color,
      value: min + ((max - min) / (steps - 1)) * index
    }));
    return { min, max, stops };
  }, [analysis]);

  function addPlace(lat: number, lon: number, label: string, kind: AnchorType) {
    const id = `place-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setAnchors((prev) => [...prev, { id, label, lat, lon, kind }]);
  }

  function removeAnchor(id: string) {
    setAnchors((prev) => prev.filter((anchor) => anchor.id !== id));
  }

  function handleSchoolKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!schoolResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSchoolHighlight((prev) => (prev + 1) % schoolResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSchoolHighlight((prev) => (prev - 1 + schoolResults.length) % schoolResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = schoolResults[schoolHighlight];
      if (!match) return;
      setSchool({
        id: `school-${Date.now()}`,
        label: match.label,
        lat: match.lat,
        lon: match.lon,
        kind: "School"
      });
      setSchoolResults([]);
      setSchoolHighlight(0);
    }
  }

  function handlePlaceKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!placeResults.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setPlaceHighlight((prev) => (prev + 1) % placeResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setPlaceHighlight((prev) => (prev - 1 + placeResults.length) % placeResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = placeResults[placeHighlight];
      if (!match) return;
      addPlace(match.lat, match.lon, `${placeKind}: ${match.label}`, placeKind);
      setPlaceResults([]);
      setPlaceHighlight(0);
    }
  }


  async function handleAnalyze() {
    const allAnchors = school ? [school, ...anchors] : anchors;
    if (allAnchors.length === 0) {
      setError("Select your school and add any other frequent places.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await analyze({
        candidates: allAnchors.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
        preferences
      });
      setAnalysis(response);
      const ranked = response.map.markers.reduce<Record<string, number>>((acc, marker) => {
        acc[marker.candidate_id] = marker.rank;
        return acc;
      }, {});
      setSchool((prev) => (prev ? { ...prev, rank: ranked[prev.id] } : prev));
      setAnchors((prev) => prev.map((anchor) => ({ ...anchor, rank: ranked[anchor.id] })));
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
            Select your school and add other frequent places (work, gym, etc.) to generate a rent
            heatmap and neighborhood recommendations. All safety/transit/amenity signals come from
            the available open data sources.
          </p>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <section className="rounded-3xl bg-white p-4 shadow-soft">
              <div className="flex h-[520px] flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs text-ink/60">
                  Tip: use search to add your school and other frequent places.
                </span>
              </div>
              <div className="relative flex-1 overflow-hidden rounded-2xl">
                <MapView
                  center={mapCenter}
                  candidates={school ? [school, ...anchors] : anchors}
                  overlay={analysis?.map.overlays?.geojson ?? null}
                  heatmapScale={heatmapScale}
                  selectedCellId={selectedCell?.cellId ?? null}
                  onSelectRegion={(payload) => setSelectedCell(payload)}
                  onBoundsChange={(bounds) => setMapBounds(bounds)}
                />
              </div>
              {heatmapScale ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-ink/60">Rent heatmap</span>
                    <span className="rounded-full bg-ink/5 px-2 py-1 text-[10px] uppercase tracking-wide text-ink/60">
                      Avg price
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {heatmapScale.stops.map((stop) => (
                      <div key={stop.value} className="flex items-center gap-1">
                        <span
                          className="h-3 w-3 rounded-full"
                          style={{ background: stop.color }}
                        />
                        <span>${Math.round(stop.value)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          <section className="flex flex-col gap-4 rounded-3xl bg-white p-6 shadow-soft">
            <div>
              <h2 className="font-display text-xl">Your Places & Preferences</h2>
              <p className="text-sm text-ink/60">
                Frontend only talks to the orchestrator API — MCP tools handle data access.
              </p>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">School location</h3>
                  {school ? (
                    <button
                      onClick={() => setSchool(null)}
                      className="rounded-full border border-ink/10 px-2 py-1 text-xs"
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <input
                    value={schoolQuery}
                    onChange={(event) => setSchoolQuery(event.target.value)}
                    placeholder="Search school address"
                    onKeyDown={handleSchoolKey}
                    className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  />
                  <span className="rounded-xl bg-ink/5 px-4 py-2 text-xs text-ink/60">
                    Auto
                  </span>
                </div>
                {schoolQuery.trim().length >= 2 ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-ink/10 bg-ink/5 p-2 text-xs">
                    {schoolLoading ? (
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">
                        Searching…
                      </div>
                    ) : schoolResults.length === 0 ? (
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">
                        No matches yet.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {schoolResults.map((result, index) => (
                          <button
                            key={`${result.lat}-${result.lon}`}
                            type="button"
                            onClick={() => {
                              setSchool({
                                id: `school-${Date.now()}`,
                                label: result.label,
                                lat: result.lat,
                                lon: result.lon,
                                kind: "School"
                              });
                              setSchoolResults([]);
                              setSchoolHighlight(0);
                            }}
                            onMouseEnter={() => setSchoolHighlight(index)}
                            className={`rounded-lg px-3 py-2 text-left text-xs ${
                              index === schoolHighlight
                                ? "bg-ink text-white"
                                : "bg-white text-ink hover:bg-ink/5"
                            }`}
                          >
                            {result.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
                {school ? (
                  <div className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs">
                    <div className="font-semibold">{school.label}</div>
                    <div className="text-ink/50">
                      {school.lat.toFixed(4)}, {school.lon.toFixed(4)}
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Other frequent places</h3>
                <span className="text-xs text-ink/50">{anchors.length} added</span>
              </div>
              <div className="mt-3 flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <label className="text-xs uppercase tracking-wide text-ink/60">Type</label>
                  <select
                    value={placeKind}
                    onChange={(event) => setPlaceKind(event.target.value as AnchorType)}
                    className="rounded-full border border-ink/10 px-3 py-2 text-xs"
                  >
                    <option>Work</option>
                    <option>Other</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <input
                    value={placeQuery}
                    onChange={(event) => setPlaceQuery(event.target.value)}
                    placeholder="Search address to add a place"
                    onKeyDown={handlePlaceKey}
                    className="w-full rounded-xl border border-ink/10 px-3 py-2 text-sm"
                  />
                  <span className="rounded-xl bg-ink/5 px-4 py-2 text-xs text-ink/60">
                    Auto
                  </span>
                </div>
                {placeQuery.trim().length >= 2 ? (
                  <div className="flex flex-col gap-2 rounded-xl border border-ink/10 bg-ink/5 p-2 text-xs">
                    {placeLoading ? (
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">
                        Searching…
                      </div>
                    ) : placeResults.length === 0 ? (
                      <div className="rounded-lg bg-white px-3 py-2 text-xs text-ink/60">
                        No matches yet.
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {placeResults.map((result, index) => (
                          <button
                            key={`${result.lat}-${result.lon}-${placeKind}`}
                            type="button"
                            onClick={() => {
                              addPlace(
                                result.lat,
                                result.lon,
                                `${placeKind}: ${result.label}`,
                                placeKind
                              );
                              setPlaceResults([]);
                              setPlaceHighlight(0);
                            }}
                            onMouseEnter={() => setPlaceHighlight(index)}
                            className={`rounded-lg px-3 py-2 text-left text-xs ${
                              index === placeHighlight
                                ? "bg-ink text-white"
                                : "bg-white text-ink hover:bg-ink/5"
                            }`}
                          >
                            {result.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 flex flex-col gap-2 text-sm">
                {anchors.length === 0 ? (
                  <p className="text-xs text-ink/60">No places yet. Use search to add.</p>
                ) : (
                  anchors.map((anchor) => (
                    <div
                      key={anchor.id}
                      className="flex items-start justify-between gap-2 rounded-xl border border-ink/10 px-3 py-2"
                    >
                      <div>
                        <div className="font-semibold">
                          {anchor.rank ? `#${anchor.rank} · ` : ""}
                          {anchor.label}
                        </div>
                        <div className="text-xs text-ink/50">
                          {anchor.kind} · {anchor.lat.toFixed(4)}, {anchor.lon.toFixed(4)}
                        </div>
                      </div>
                      <button
                        onClick={() => removeAnchor(anchor.id)}
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
              <h3 className="text-sm font-semibold">Selected area</h3>
              {selectedCell ? (
                <div className="mt-3 text-sm">
                  <div className="rounded-xl bg-ink/5 px-3 py-2">
                    <div className="font-semibold">Cell {selectedCell.cellId}</div>
                    <div className="text-xs text-ink/60">
                      Avg rent: ${selectedCell.avgPrice.toFixed(0)} · {selectedCell.count} listings
                    </div>
                  </div>
                  <div className="mt-3 text-xs text-ink/70">
                    <p>
                      This area’s historical average rent is{" "}
                      {preferences.price_range.min !== null &&
                      selectedCell.avgPrice < preferences.price_range.min
                        ? "below"
                        : preferences.price_range.max !== null &&
                            selectedCell.avgPrice > preferences.price_range.max
                          ? "above"
                          : "within"}{" "}
                      your target range. Use the heatmap to compare nearby zones.
                    </p>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink/60">
                  Click a colored cell on the map to see pricing metrics and context.
                </p>
              )}
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
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Price min</span>
                  <input
                    type="number"
                    value={preferences.price_range.min ?? ""}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        price_range: {
                          ...prev.price_range,
                          min: event.target.value ? Number(event.target.value) : null
                        }
                      }))
                    }
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Price max</span>
                  <input
                    type="number"
                    value={preferences.price_range.max ?? ""}
                    onChange={(event) =>
                      setPreferences((prev) => ({
                        ...prev,
                        price_range: {
                          ...prev.price_range,
                          max: event.target.value ? Number(event.target.value) : null
                        }
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
              {loading ? "Analyzing..." : "Generate heatmap"}
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
