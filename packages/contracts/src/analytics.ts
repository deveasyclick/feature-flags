import { z } from "zod";
import { evaluationReasonSchema } from "#evaluation";

export const evaluationEventSchema = z.object({
  kind: z.enum(["evaluation", "outcome"]).default("evaluation"),
  outcome: z.enum(["success", "error"]).optional(),
  flagVersion: z.number().int().positive().optional(),
  id: z.string().uuid(),
  flagKey: z.string().min(1).max(128),
  variation: z.string().max(128),
  reason: evaluationReasonSchema,
  userId: z.string().max(256).optional(),
  latencyMs: z.number().finite().min(0).max(60_000),
}).refine((event) => event.kind !== "outcome" || event.outcome !== undefined, { message: "Application outcomes require success or error." });
export type EvaluationEvent = z.infer<typeof evaluationEventSchema>;
export const evaluationEventBatchSchema = z.object({ events: z.array(evaluationEventSchema).min(1).max(100) });
export type EvaluationEventBatch = z.infer<typeof evaluationEventBatchSchema>;

export const analyticsQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(90).default(7),
  projectKey: z.string().min(1).max(128).optional(),
});
export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

export const analyticsSummarySchema = z.object({
  days: z.number(),
  evaluations: z.number(),
  users: z.number(),
  errors: z.number(),
  avgLatencyMs: z.number(),
  p95LatencyMs: z.number(),
  daily: z.array(z.object({ date: z.string(), evaluations: z.number() })),
  topFlags: z.array(z.object({ flagKey: z.string(), projectKey: z.string(), evaluations: z.number() })),
  environments: z.array(z.object({ environmentKey: z.string(), evaluations: z.number() })),
});
export type AnalyticsSummary = z.infer<typeof analyticsSummarySchema>;
