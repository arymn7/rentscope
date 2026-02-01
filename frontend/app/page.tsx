"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { Candidate as MapCandidate } from "../components/MapView";
import {
  analyze,
  areaSummary,
  fetchRentPoints,
  geocode,
  reverseGeocode,
  whatIf,
  type AnalyzeResponse
} from "../lib/api";

const MapView = dynamic(() => import("../components/MapView"), { ssr: false });

type AnchorType = "School" | "Work" | "Other";
type WeightRank = "low" | "mid" | "high";

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
    weights: { safety: "mid", transit: "mid", amenities: "low" } as Record<string, WeightRank>,
    radius_m: 600,
    window_days: 30,
    poi_categories: ["grocery", "cafe"],
    price_range: { min: 1600, max: 2600 }
  });
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatIfBudget, setWhatIfBudget] = useState(0);
  const [whatIfCommute, setWhatIfCommute] = useState(0);
  const [whatIfResult, setWhatIfResult] = useState<{
    summary: string;
    key_changes: string[];
    baseline: AnalyzeResponse["ranking"];
    scenario: AnalyzeResponse["ranking"];
  } | null>(null);
  const [whatIfLoading, setWhatIfLoading] = useState(false);
  const [whatIfError, setWhatIfError] = useState<string | null>(null);
  const [heatmapMode] = useState<"rent" | "crime">("rent");
  const [mapBounds, setMapBounds] = useState<{
    latMin: number;
    latMax: number;
    lonMin: number;
    lonMax: number;
  } | null>(null);
  const [selectedCell, setSelectedCell] = useState<{
    cellId: string;
    avgPrice?: number;
    count: number;
    areaName?: string;
  } | null>(null);
  const [expandedAreaId, setExpandedAreaId] = useState<string | null>(null);
  const [areaAmenities, setAreaAmenities] = useState<Record<string, string[]>>({});
  const [areaLabels, setAreaLabels] = useState<Record<string, string>>({});
  const [rentPoints, setRentPoints] = useState<
    Array<{ lat: number; lon: number; price: string; bedroom: number; bathroom: number; den: number }>
  >([]);

  const showSidebar = !analysis;

  const displayMarkers = useMemo(() => {
    if (!analysis) return school ? [school, ...anchors] : anchors;
    return analysis.map.markers.map((marker) => {
      const details = analysis.details[marker.candidate_id];
      const label =
        areaLabels[marker.candidate_id] ??
        details?.label ??
        analysis.ranking.find((item) => item.candidate_id === marker.candidate_id)?.label ??
        marker.candidate_id;
      return { id: marker.candidate_id, label, lat: marker.lat, lon: marker.lon, rank: marker.rank };
    });
  }, [analysis, anchors, areaLabels, school]);

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

  const activeOverlay = useMemo(() => {
    return analysis?.map.overlays?.rent_geojson ?? null;
  }, [analysis]);

  const heatmapScale = useMemo(() => {
    const overlay = activeOverlay;
    if (!overlay || !("features" in overlay)) return null;
    const features = (overlay as GeoJSON.FeatureCollection).features ?? [];
    const metricKey = heatmapMode === "crime" ? "count" : "avg_price";
    const values = features
      .map((feature) => (feature.properties as Record<string, number> | undefined)?.[metricKey])
      .filter((value): value is number => typeof value === "number");
    if (values.length === 0) return null;
    const min = Math.min(...values);
    const maxRaw = Math.max(...values);
    const max = maxRaw === min ? min + 1 : maxRaw;
    const steps = 5;
    const palette =
      heatmapMode === "crime"
        ? ["#eaf2f8", "#c6dbef", "#9ecae1", "#6baed6", "#2171b5"]
        : ["#fef0d9", "#fdd49e", "#fdbb84", "#fc8d59", "#d7301f"];
    const stops = palette.map((color, index) => ({
      color,
      value: min + ((max - min) / (steps - 1)) * index
    }));
    return { min, max, stops };
  }, [activeOverlay, heatmapMode]);

  useEffect(() => {
    setSelectedCell(null);
  }, [analysis]);

  useEffect(() => {
    if (!analysis) return;
    const topAreas = analysis.ranking.slice(0, 6);
    topAreas.forEach(async (item) => {
      if (areaLabels[item.candidate_id]) return;
      const details = analysis.details[item.candidate_id];
      if (!details?.center) return;
      try {
        const label = await reverseGeocode(details.center.lat, details.center.lon);
        setAreaLabels((prev) => ({ ...prev, [item.candidate_id]: label }));
      } catch {
        // ignore lookup errors
      }
    });
  }, [analysis]);

  useEffect(() => {
    if (!mapBounds) return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const data = await fetchRentPoints(mapBounds);
        if (!cancelled) setRentPoints(data.results);
      } catch {
        if (!cancelled) setRentPoints([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [mapBounds]);

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
      const mappedWeights = Object.fromEntries(
        Object.entries(preferences.weights).map(([key, rank]) => [
          key,
          rank === "high" ? 0.6 : rank === "mid" ? 0.4 : 0.2
        ])
      );
      const response = await analyze({
        candidates: allAnchors.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
        map_bounds: mapBounds
          ? {
              lat_min: mapBounds.latMin,
              lat_max: mapBounds.latMax,
              lon_min: mapBounds.lonMin,
              lon_max: mapBounds.lonMax
            }
          : undefined,
        preferences: {
          ...preferences,
          weights: mappedWeights
        }
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

  async function handleWhatIf() {
    const allAnchors = school ? [school, ...anchors] : anchors;
    if (allAnchors.length === 0) {
      setWhatIfError("Add at least one place before running a what-if.");
      return;
    }
    setWhatIfLoading(true);
    setWhatIfError(null);
    try {
      const mappedWeights = Object.fromEntries(
        Object.entries(preferences.weights).map(([key, rank]) => [
          key,
          rank === "high" ? 0.6 : rank === "mid" ? 0.4 : 0.2
        ])
      );
      const response = await whatIf({
        candidates: allAnchors.map(({ id, label, lat, lon }) => ({ id, label, lat, lon })),
        map_bounds: mapBounds
          ? {
              lat_min: mapBounds.latMin,
              lat_max: mapBounds.latMax,
              lon_min: mapBounds.lonMin,
              lon_max: mapBounds.lonMax
            }
          : undefined,
        preferences: {
          ...preferences,
          weights: mappedWeights
        },
        what_if: {
          budget_delta: whatIfBudget,
          commute_delta_min: whatIfCommute
        }
      });
      setWhatIfResult({
        summary: response.summary.summary,
        key_changes: response.summary.key_changes,
        baseline: response.baseline.ranking,
        scenario: response.what_if.ranking
      });
    } catch (err) {
      setWhatIfError((err as Error).message);
    } finally {
      setWhatIfLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-mesh px-6 py-8 text-ink">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl bg-white/80 p-6 shadow-soft backdrop-blur">
          <h1 className="mt-1 font-display text-3xl md:text-4xl">RentScope</h1>
          <p className="mt-2 max-w-2xl text-base text-ink/70">
            Add your school and key spots to reveal rent hot zones and neighborhood picks.
          </p>
        </header>

        <div
          className={`grid gap-6 ${
            showSidebar ? "lg:grid-cols-[1.1fr_0.9fr]" : "lg:grid-cols-[1fr]"
          }`}
        >
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
                  candidates={displayMarkers}
                  listings={rentPoints}
                  overlay={activeOverlay ?? null}
                  heatmapScale={heatmapScale}
                  heatmapMetric="avg_price"
                  selectedCellId={selectedCell?.cellId ?? null}
                  onSelectRegion={async (payload) => {
                    try {
                      const name = await reverseGeocode(payload.lat, payload.lon);
                      setSelectedCell({ ...payload, areaName: name });
                    } catch {
                      setSelectedCell(payload);
                    }
                  }}
                  onBoundsChange={(bounds) => setMapBounds(bounds)}
                />
              </div>
              {analysis ? (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 text-xs">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-ink/60">Rent heatmap</span>
                    </div>
                    <span className="rounded-full bg-ink/5 px-2 py-1 text-[10px] uppercase tracking-wide text-ink/60">
                      Avg price
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {heatmapScale ? (
                      heatmapScale.stops.map((stop) => (
                        <div key={stop.value} className="flex items-center gap-1">
                          <span
                            className="h-3 w-3 rounded-full"
                            style={{ background: stop.color }}
                          />
                          <span>${Math.round(stop.value)}</span>
                        </div>
                      ))
                    ) : (
                      <span className="text-ink/50">No heatmap data yet.</span>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </section>

          {showSidebar ? (
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
                    <div className="font-semibold">
                      {selectedCell.areaName ? selectedCell.areaName : `Cell ${selectedCell.cellId}`}
                    </div>
                    <div className="text-xs text-ink/60">
                      Avg rent: $${(selectedCell.avgPrice ?? 0).toFixed(0)} ·{" "}
                      {selectedCell.count} listings
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
                    <select
                      value={preferences.weights[key]}
                      onChange={(event) => {
                        setPreferences((prev) => ({
                          ...prev,
                          weights: { ...prev.weights, [key]: event.target.value as WeightRank }
                        }));
                      }}
                      className="rounded-lg border border-ink/10 px-2 py-1"
                    >
                      <option value="low">Low</option>
                      <option value="mid">Mid</option>
                      <option value="high">High</option>
                    </select>
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
                  <span className="uppercase text-ink/50">Amenities</span>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    {["grocery", "cafe", "library", "pharmacy"].map((category) => (
                      <label
                        key={category}
                        className="flex items-center gap-2 rounded-lg border border-ink/10 bg-white px-2 py-2"
                      >
                        <input
                          type="checkbox"
                          checked={preferences.poi_categories.includes(category)}
                          onChange={(event) =>
                            setPreferences((prev) => ({
                              ...prev,
                              poi_categories: event.target.checked
                                ? [...prev.poi_categories, category]
                                : prev.poi_categories.filter((item) => item !== category)
                            }))
                          }
                        />
                        <span className="capitalize">{category}</span>
                      </label>
                    ))}
                  </div>
                </label>
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">What-if explorer</h3>
                <span className="text-xs text-ink/50">Gemini summary</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Budget delta</span>
                  <input
                    type="number"
                    value={whatIfBudget}
                    onChange={(event) => setWhatIfBudget(Number(event.target.value))}
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="uppercase text-ink/50">Commute delta (min)</span>
                  <input
                    type="number"
                    value={whatIfCommute}
                    onChange={(event) => setWhatIfCommute(Number(event.target.value))}
                    className="rounded-lg border border-ink/10 px-2 py-1"
                  />
                </label>
              </div>
              <button
                onClick={handleWhatIf}
                disabled={whatIfLoading}
                className="mt-3 w-full rounded-xl bg-accent px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
              >
                {whatIfLoading ? "Running what-if..." : "Run what-if"}
              </button>
              {whatIfError ? <div className="mt-2 text-xs text-red-600">{whatIfError}</div> : null}
              {whatIfResult ? (
                <div className="mt-3 rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs">
                  <div className="font-semibold">Summary</div>
                  <p className="mt-1 text-ink/70">{whatIfResult.summary}</p>
                  <ul className="mt-2 list-disc pl-4 text-ink/70">
                    {whatIfResult.key_changes.map((item, index) => (
                      <li key={`whatif-${index}`}>{item}</li>
                    ))}
                  </ul>
                  <div className="mt-2 text-ink/70">
                    <strong>Top 3:</strong>{" "}
                    {whatIfResult.baseline.slice(0, 3).map((item) => item.candidate_id).join(", ")} →
                    {` ${whatIfResult.scenario.slice(0, 3).map((item) => item.candidate_id).join(", ")}`}
                  </div>
                </div>
              ) : null}
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
          ) : null}
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
                const isExpanded = expandedAreaId === item.candidate_id;
                return (
                  <div
                    key={item.candidate_id}
                    className={`rounded-2xl border border-ink/10 p-4 transition ${
                      isExpanded ? "bg-ink/5" : ""
                    }`}
                    onClick={async () => {
                      setExpandedAreaId((prev) =>
                        prev === item.candidate_id ? null : item.candidate_id
                      );
                      if (details.center) {
                        setSelectedCell({
                          cellId: item.candidate_id,
                          count: Number(details.evidence?.[1]?.value ?? 0),
                          avgPrice: Number(details.evidence?.[0]?.value ?? 0),
                          areaName:
                            areaLabels[item.candidate_id] ?? details.label ?? item.label
                        });
                      }
                      if (details.center && !areaAmenities[item.candidate_id]) {
                        try {
                          const summary = await areaSummary({
                            lat: details.center.lat,
                            lon: details.center.lon,
                            label: details.label ?? item.label
                          });
                          setAreaAmenities((prev) => ({
                            ...prev,
                            [item.candidate_id]: summary.amenities ?? []
                          }));
                        } catch {
                          // ignore summary errors
                        }
                      }
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="font-semibold">
                        {areaLabels[item.candidate_id] ??
                          item.label ??
                          details.label ??
                          item.candidate_id}
                      </h3>
                      <span className="text-sm font-semibold text-accent">
                        {item.overall_score_0_100.toFixed(1)} / 100
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-ink/70">{item.summary}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                      {"affordability" in details.subscores ? (
                        <>
                          <div className="rounded-lg bg-ink/5 p-2">
                            Affordability: {details.subscores.affordability}
                          </div>
                          <div className="rounded-lg bg-ink/5 p-2">Safety: {details.subscores.safety}</div>
                          <div className="rounded-lg bg-ink/5 p-2">Transit: {details.subscores.transit}</div>
                        </>
                      ) : (
                        <>
                          <div className="rounded-lg bg-ink/5 p-2">Safety: {details.subscores.safety}</div>
                          <div className="rounded-lg bg-ink/5 p-2">Transit: {details.subscores.transit}</div>
                          <div className="rounded-lg bg-ink/5 p-2">
                            Amenities: {details.subscores.amenities}
                          </div>
                        </>
                      )}
                    </div>
                    <div className="mt-3 text-xs text-ink/70">
                      <strong>Tradeoffs:</strong> {item.key_tradeoffs.join("; ")}
                    </div>
                    <div className="mt-3 text-xs">
                      <strong>Evidence:</strong>
                      <ul className="mt-1 list-disc pl-4">
                        {details.evidence.map((entry, index) => (
                          <li key={`${item.candidate_id}-e-${index}`}>
                            {entry.metric.replace("POI", "Amenities")}: {entry.value}
                          </li>
                        ))}
                      </ul>
                    </div>
                    {isExpanded ? (
                      <div className="mt-4 w-full rounded-xl border border-ink/10 bg-white px-3 py-2 text-xs">
                        <div className="font-semibold">Amenities nearby</div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {(areaAmenities[item.candidate_id] ?? []).length ? (
                            areaAmenities[item.candidate_id].map((name) => (
                              <span
                                key={`${item.candidate_id}-${name}`}
                                className="rounded-full bg-ink/5 px-2 py-1 text-[10px]"
                              >
                                {name}
                              </span>
                            ))
                          ) : (
                            <span className="text-ink/60">No amenities found.</span>
                          )}
                        </div>
                      </div>
                    ) : null}
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
