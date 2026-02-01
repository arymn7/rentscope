"use client";

import "leaflet/dist/leaflet.css";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, GeoJSON } from "react-leaflet";
import L, { LatLngExpression } from "leaflet";
import { useMemo } from "react";

export type Candidate = {
  id: string;
  label: string;
  lat: number;
  lon: number;
  rank?: number;
};

type MapViewProps = {
  center: LatLngExpression;
  candidates: Candidate[];
  overlay?: GeoJSON.GeoJsonObject | null;
  heatmapScale?: { stops: Array<{ value: number; color: string }>; min: number; max: number } | null;
  selectedCellId?: string | null;
  onAdd?: (lat: number, lon: number) => void;
  onSelectRegion?: (payload: { cellId: string; avgPrice: number; count: number }) => void;
  onBoundsChange?: (bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => void;
};

function ClickHandler({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
      onAdd(event.latlng.lat, event.latlng.lng);
    }
  });
  return null;
}

function BoundsReporter({
  onBoundsChange
}: {
  onBoundsChange: (bounds: { latMin: number; latMax: number; lonMin: number; lonMax: number }) => void;
}) {
  useMapEvents({
    moveend(event) {
      const bounds = event.target.getBounds();
      onBoundsChange({
        latMin: bounds.getSouth(),
        latMax: bounds.getNorth(),
        lonMin: bounds.getWest(),
        lonMax: bounds.getEast()
      });
    }
  });
  return null;
}

function createRankIcon(rank?: number) {
  const label = rank ? `#${rank}` : "★";
  const color = !rank
    ? "#3d5afe"
    : rank === 1
      ? "#ff6a3d"
      : rank === 2
        ? "#18a999"
        : "#0c0d12";

  return L.divIcon({
    html: `<div style="display:flex;align-items:center;justify-content:center;width:34px;height:34px;border-radius:50%;background:${color};color:#fff;font-weight:700;font-size:12px;box-shadow:0 6px 16px rgba(0,0,0,0.18)">${label}</div>`,
    className: "",
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

function colorForValue(
  value: number,
  stops: Array<{ value: number; color: string }>,
  fallback: string
) {
  for (let i = stops.length - 1; i >= 0; i -= 1) {
    if (value >= stops[i].value) return stops[i].color;
  }
  return fallback;
}

export default function MapView({
  center,
  candidates,
  overlay,
  heatmapScale,
  selectedCellId,
  onAdd,
  onSelectRegion,
  onBoundsChange
}: MapViewProps) {
  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; Mapbox &copy; OpenStreetMap contributors'
        url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/256/{z}/{x}/{y}@2x?access_token=${
          process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? ""
        }`}
      />
      {onAdd ? <ClickHandler onAdd={onAdd} /> : null}
      {onBoundsChange ? <BoundsReporter onBoundsChange={onBoundsChange} /> : null}
      {overlay ? (
        <GeoJSON
          data={overlay as GeoJSON.GeoJsonObject}
          style={(feature) => {
            const props = feature?.properties as
              | { avg_price?: number; cell_id?: string }
              | undefined;
            const avgPrice = props?.avg_price;
            const cellId = props?.cell_id;
            const isSelected = selectedCellId && cellId === selectedCellId;
            const fillColor =
              typeof avgPrice === "number" && heatmapScale
                ? colorForValue(avgPrice, heatmapScale.stops, "#f4f1ea")
                : "#f4f1ea";
            return {
              color: isSelected ? "#111827" : "#f1e3d2",
              weight: isSelected ? 2 : 1,
              fillColor,
              fillOpacity: isSelected ? 0.7 : 0.55
            };
          }}
          onEachFeature={(feature, layer) => {
            layer.on({
              click: () => {
                const props = feature?.properties as
                  | { avg_price?: number; count?: number; cell_id?: string }
                  | undefined;
                if (!props?.cell_id || typeof props.avg_price !== "number") return;
                onSelectRegion?.({
                  cellId: props.cell_id,
                  avgPrice: props.avg_price,
                  count: props.count ?? 0
                });
              }
            });
          }}
        />
      ) : null}
      {candidates.map((candidate) => (
        <Marker
          key={candidate.id}
          position={[candidate.lat, candidate.lon]}
          icon={createRankIcon(candidate.rank)}
        >
          <Popup>
            <strong>{candidate.label}</strong>
            <div>{candidate.rank ? `Rank #${candidate.rank}` : "Unranked"}</div>
          </Popup>
        </Marker>
      ))}
    </MapContainer>
  );
}
