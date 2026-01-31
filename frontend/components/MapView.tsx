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
  campus: { lat: number; lon: number; label: string };
  overlay?: GeoJSON.GeoJsonObject | null;
  onAdd: (lat: number, lon: number) => void;
};

function ClickHandler({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({
    click(event) {
      onAdd(event.latlng.lat, event.latlng.lng);
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

export default function MapView({ center, candidates, campus, overlay, onAdd }: MapViewProps) {
  const campusIcon = useMemo(() => createRankIcon(), []);

  return (
    <MapContainer center={center} zoom={13} scrollWheelZoom className="h-full w-full">
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      <ClickHandler onAdd={onAdd} />
      {overlay ? <GeoJSON data={overlay as GeoJSON.GeoJsonObject} /> : null}
      <Marker position={[campus.lat, campus.lon]} icon={campusIcon}>
        <Popup>
          <strong>{campus.label}</strong>
        </Popup>
      </Marker>
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
