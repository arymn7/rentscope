import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { z } from "zod";
import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  AmenitiesAgentSchema,
  AggregatorSchema,
  SafetyAgentSchema,
  TransitAgentSchema
} from "./schemas.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = path.join(__dirname, "..", "prompts");

const PROMPTS = {
  safety: readFileSync(path.join(PROMPTS_DIR, "safety.txt"), "utf8"),
  transit: readFileSync(path.join(PROMPTS_DIR, "transit.txt"), "utf8"),
  amenities: readFileSync(path.join(PROMPTS_DIR, "amenities.txt"), "utf8"),
  aggregator: readFileSync(path.join(PROMPTS_DIR, "aggregator.txt"), "utf8")
};

const GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "";
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? "gemini-1.5-flash";

function extractJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("No JSON object found");
  }
  return JSON.parse(text.slice(start, end + 1));
}

async function runGemini(prompt: string, payload: unknown) {
  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: prompt
  });

  const result = await model.generateContent([
    {
      text: JSON.stringify(payload)
    }
  ]);

  return result.response.text();
}

async function runAgentWithRetry<T>(
  prompt: string,
  payload: unknown,
  schema: z.ZodSchema<T>
): Promise<T> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY not set");
  }

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await runGemini(prompt, payload);
      const json = extractJson(response);
      return schema.parse(json);
    } catch (error) {
      lastError = error as Error;
    }
  }
  throw lastError ?? new Error("Agent failed");
}

function normalizeWeight(value: number) {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(value, 0);
}

export async function runSafetyAgent(payload: unknown) {
  try {
    return await runAgentWithRetry(PROMPTS.safety, payload, SafetyAgentSchema);
  } catch {
    const data = payload as { candidate_id: string; crime_summary: any };
    const counts = Object.values(data.crime_summary?.counts_by_type ?? {}) as number[];
    const total = counts.reduce((sum, value) => sum + value, 0);
    const rateHint = String(data.crime_summary?.rate_hint ?? "");
    let score = rateHint.includes("lower") ? 80 : rateHint.includes("moderate") ? 60 : 45;
    score = Math.max(10, score - Math.min(total * 4, 40));
    return SafetyAgentSchema.parse({
      candidate_id: data.candidate_id,
      score_0_100: Math.round(score),
      summary: `Incident density appears ${rateHint || "unknown"} based on available data.`,
      pros: total < 5 ? ["Lower recent incident count in radius"] : ["Some recent incidents logged"],
      cons: total > 8 ? ["Higher incident count within radius"] : ["Limited coverage window"],
      evidence: [
        {
          metric: "Incident count (window)",
          value: String(total),
          source: data.crime_summary?.source ?? "MCP crime_summary"
        }
      ]
    });
  }
}

export async function runTransitAgent(payload: unknown) {
  try {
    return await runAgentWithRetry(PROMPTS.transit, payload, TransitAgentSchema);
  } catch {
    const data = payload as { candidate_id: string; commute_proxy: any };
    const minutes = Number(data.commute_proxy?.est_minutes ?? 0);
    const hint = String(data.commute_proxy?.near_transit_hint ?? "");
    let score = 100 - Math.min(minutes * 2, 80);
    if (hint.includes("near")) score += 5;
    return TransitAgentSchema.parse({
      candidate_id: data.candidate_id,
      score_0_100: Math.round(score),
      summary: `Estimated commute ${minutes} min with ${hint}.`,
      pros: minutes < 25 ? ["Short estimated commute"] : ["Commute proxy within acceptable range"],
      cons: minutes > 35 ? ["Longer estimated commute"] : ["Transit hint based on nearest stop"],
      evidence: [
        {
          metric: "Estimated minutes",
          value: String(minutes),
          source: data.commute_proxy?.source ?? "MCP commute_proxy"
        }
      ]
    });
  }
}

export async function runAmenitiesAgent(payload: unknown) {
  try {
    return await runAgentWithRetry(PROMPTS.amenities, payload, AmenitiesAgentSchema);
  } catch {
    const data = payload as { candidate_id: string; nearby_pois: any };
    const counts = Object.values(data.nearby_pois?.counts_by_category ?? {}) as number[];
    const total = counts.reduce((sum, value) => sum + value, 0);
    let score = Math.min(total * 8, 100);
    if (total === 0) score = 20;
    return AmenitiesAgentSchema.parse({
      candidate_id: data.candidate_id,
      score_0_100: Math.round(score),
      summary: `Found ${total} POIs in requested categories.`,
      pros: total > 5 ? ["Multiple nearby amenities"] : ["Some nearby amenities"],
      cons: total < 3 ? ["Limited amenity density within radius"] : ["Categories unevenly distributed"],
      evidence: [
        {
          metric: "POI count",
          value: String(total),
          source: data.nearby_pois?.source ?? "MCP nearby_pois"
        }
      ]
    });
  }
}

export async function runAggregatorAgent(payload: unknown) {
  try {
    return await runAgentWithRetry(PROMPTS.aggregator, payload, AggregatorSchema);
  } catch {
    const data = payload as {
      candidates: Array<{
        candidate_id: string;
        overall_score_0_100: number;
        subscores: { safety: number; transit: number; amenities: number };
        pros: string[];
        cons: string[];
        evidence: { metric: string; value: string; source: string }[];
      }>;
    };

    const ranking = [...data.candidates]
      .sort((a, b) => b.overall_score_0_100 - a.overall_score_0_100)
      .map((candidate) => ({
        candidate_id: candidate.candidate_id,
        overall_score_0_100: Math.round(candidate.overall_score_0_100),
        summary: "Weighted score based on safety, transit, and amenities signals.",
        key_tradeoffs: [
          `Safety ${candidate.subscores.safety}, Transit ${candidate.subscores.transit}, Amenities ${candidate.subscores.amenities}`
        ]
      }));

    const details: Record<string, any> = {};
    for (const candidate of data.candidates) {
      details[candidate.candidate_id] = {
        subscores: candidate.subscores,
        pros: candidate.pros,
        cons: candidate.cons,
        evidence: candidate.evidence
      };
    }

    return AggregatorSchema.parse({ ranking, details });
  }
}

export function normalizeWeights(weights: { safety: number; transit: number; amenities: number }) {
  const safety = normalizeWeight(weights.safety);
  const transit = normalizeWeight(weights.transit);
  const amenities = normalizeWeight(weights.amenities);
  const total = safety + transit + amenities || 1;
  return {
    safety: safety / total,
    transit: transit / total,
    amenities: amenities / total
  };
}
