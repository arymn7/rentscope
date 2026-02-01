import { z } from "zod";

export const CandidateSchema = z.object({
  id: z.string(),
  label: z.string(),
  lat: z.number(),
  lon: z.number()
});

export const AnalyzeRequestSchema = z.object({
  candidates: z.array(CandidateSchema).min(1).max(10),
  map_bounds: z
    .object({
      lat_min: z.number(),
      lat_max: z.number(),
      lon_min: z.number(),
      lon_max: z.number()
    })
    .optional(),
  preferences: z.object({
    weights: z.object({
      safety: z.number(),
      transit: z.number(),
      amenities: z.number()
    }),
    radius_m: z.number(),
    window_days: z.number(),
    poi_categories: z.array(z.string()),
    price_range: z
      .object({
        min: z.number().nullable(),
        max: z.number().nullable()
      })
      .optional()
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

export const AreaRankingSchema = z.object({
  ranking: z.array(
    z.object({
      area_id: z.string(),
      label: z.string(),
      overall_score_0_100: z.number(),
      summary: z.string(),
      key_tradeoffs: z.array(z.string())
    })
  ),
  details: z.record(
    z.object({
      label: z.string(),
      center: z.object({ lat: z.number(), lon: z.number() }),
      subscores: z.object({
        affordability: z.number(),
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

export const AreaSummarySchema = z.object({
  summary: z.string(),
  amenities: z.array(z.string()),
  highlights: z.array(z.string())
});

export const WhatIfRequestSchema = z.object({
  candidates: z.array(CandidateSchema).min(1).max(10),
  map_bounds: z
    .object({
      lat_min: z.number(),
      lat_max: z.number(),
      lon_min: z.number(),
      lon_max: z.number()
    })
    .optional(),
  preferences: z.object({
    weights: z.object({
      safety: z.number(),
      transit: z.number(),
      amenities: z.number()
    }),
    radius_m: z.number(),
    window_days: z.number(),
    poi_categories: z.array(z.string()),
    price_range: z
      .object({
        min: z.number().nullable(),
        max: z.number().nullable()
      })
      .optional()
  }),
  what_if: z.object({
    budget_delta: z.number(),
    commute_delta_min: z.number()
  })
});

export const WhatIfSummarySchema = z.object({
  summary: z.string(),
  key_changes: z.array(z.string())
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;
export type AgentOutput = z.infer<typeof AgentBaseSchema>;
export type AggregatorOutput = z.infer<typeof AggregatorSchema>;
export type WhatIfRequest = z.infer<typeof WhatIfRequestSchema>;
export type WhatIfSummary = z.infer<typeof WhatIfSummarySchema>;
export type AreaRanking = z.infer<typeof AreaRankingSchema>;
export type AreaSummary = z.infer<typeof AreaSummarySchema>;
