import { getDb } from "./mongo.js";

function roundCoord(value: number) {
  return Math.round(value * 10000) / 10000;
}

function buildKey(tool: string, lat: number, lon: number, params: Record<string, unknown>) {
  const rounded = `${roundCoord(lat)},${roundCoord(lon)}`;
  return `${tool}|${rounded}|${JSON.stringify(params)}`;
}

export async function getCached<T>(
  tool: string,
  lat: number,
  lon: number,
  params: Record<string, unknown>
): Promise<T | null> {
  const db = await getDb();
  const key = buildKey(tool, lat, lon, params);
  const result = await db.collection("analysis_cache").findOne({ key });
  return (result?.data as T) ?? null;
}

export async function setCached<T>(
  tool: string,
  lat: number,
  lon: number,
  params: Record<string, unknown>,
  data: T
) {
  const db = await getDb();
  const key = buildKey(tool, lat, lon, params);
  await db.collection("analysis_cache").updateOne(
    { key },
    {
      $set: {
        key,
        tool,
        lat: roundCoord(lat),
        lon: roundCoord(lon),
        params,
        data,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
}
