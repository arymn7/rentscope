import { z } from "zod";

export const CandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  lat: z.number(),
  lon: z.number()
});

export const AnalyzeRequestSchema = z.object({
  candidates: z.array(CandidateSchema).min(1).max(10),
  preferences: z.object({
    weights: z.object({
      safety: z.number(),
      transit: z.number(),
      amenities: z.number()
    }),
    radius_m: z.number(),
    window_days: z.number(),
    poi_categories: z.array(z.string())
  })
});

const EvidenceSchema = z.object({
  metric: z.string(),
  value: z.string(),
  source: z.string()
});

const AgentBaseSchema = z.object({
  candidate_id: z.string(),
  score_0_100: z.number(),
  summary: z.string(),
  pros: z.array(z.string()),
  cons: z.array(z.string()),
  evidence: z.array(EvidenceSchema)
});

export const SafetyAgentSchema = AgentBaseSchema;
export const TransitAgentSchema = AgentBaseSchema;
export const AmenitiesAgentSchema = AgentBaseSchema;

export const AggregatorSchema = z.object({
  ranking: z.array(
    z.object({
      candidate_id: z.string(),
      overall_score_0_100: z.number(),
      summary: z.string(),
      key_tradeoffs: z.array(z.string())
    })
  ),
  details: z.record(
    z.object({
      subscores: z.object({
        safety: z.number(),
        transit: z.number(),
        amenities: z.number()
      }),
      pros: z.array(z.string()),
      cons: z.array(z.string()),
      evidence: z.array(EvidenceSchema)
    })
  )
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AgentOutput = z.infer<typeof AgentBaseSchema>;
export type AggregatorOutput = z.infer<typeof AggregatorSchema>;
