import { z } from "zod";

import { flagStatusSchema, flagTypeSchema } from "#flag";
import { evaluationUserContextSchema } from "#evaluation";

export const clientFlagVisibilitySchema = z.object({ clientVisible: z.boolean() });
export type ClientFlagVisibility = z.infer<typeof clientFlagVisibilitySchema>;

export const clientEvaluateRequestSchema = z.object({
  user: evaluationUserContextSchema.check((ctx) => {
    if (Object.keys(ctx.value).length > 100 || Object.entries(ctx.value).some(([key, value]) => key.length > 128 || (typeof value === "string" && value.length > 1024))) ctx.issues.push({ code: "custom", input: ctx.value, message: "Use at most 100 attributes with keys up to 128 and string values up to 1024 characters." });
  }),
  flags: z.array(z.string().min(1).max(128)).min(1).max(100),
});
export type ClientEvaluateRequest = z.infer<typeof clientEvaluateRequestSchema>;

export const clientEvaluateResponseSchema = z.object({
  flags: z.record(z.string(), z.object({ value: z.unknown(), enabled: z.boolean() })),
});
export type ClientEvaluateResponse = z.infer<typeof clientEvaluateResponseSchema>;

export const sdkStreamVersionSchema = z.object({ version: z.string().min(1).max(64) });

/**
 * The SDK's configuration snapshot.
 *
 * One environment of one project, in the shape an SDK evaluates from: an SDK key
 * fetches this once, caches it and decides locally, so it never calls the API
 * per flag. It is not the dashboard's flag contract — a screen renders one flag
 * at a time, while this carries everything the engine needs to decide all of
 * them, including the variation values the typed getters return.
 *
 * The field names mirror the engine's input types, so the mapping on either side
 * is a rename at most. `attributeType` is deliberately absent: the engine decides
 * on the operator alone.
 */
export const sdkConditionSchema = z.object({
  attribute: z.string(),
  operator: z.string(),
  values: z.array(z.string()),
});

export type SdkCondition = z.infer<typeof sdkConditionSchema>;

export const sdkRuleSchema = z.object({
  id: z.string(),
  priority: z.number().int(),
  variation: z.string(),
  segmentKeys: z.array(z.string()),
  rolloutPercentage: z.number().int().nullable(),
  bucketBy: z.string().nullable(),
  conditions: z.array(sdkConditionSchema),
});

export type SdkRule = z.infer<typeof sdkRuleSchema>;

export const sdkTargetSchema = z.object({
  /** The evaluation subject the override applies to, not a dashboard user. */
  userId: z.string(),
  variation: z.string(),
});

export type SdkTarget = z.infer<typeof sdkTargetSchema>;

/** One servable value of a flag, shared by every environment. */
export const sdkVariationSchema = z.object({
  key: z.string(),
  value: z.unknown(),
});

export type SdkVariation = z.infer<typeof sdkVariationSchema>;

export const sdkFlagSchema = z.object({
  version: z.number().int().positive().optional(),
  key: z.string(),
  type: flagTypeSchema,
  status: flagStatusSchema,
  /** What the flag does in the environment this snapshot is for. */
  enabled: z.boolean(),
  offVariation: z.string(),
  defaultVariation: z.string(),
  rolloutPercentage: z.number().int(),
  bucketBy: z.string(),
  variations: z.array(sdkVariationSchema),
  rules: z.array(sdkRuleSchema),
  targets: z.array(sdkTargetSchema),
});

export type SdkFlag = z.infer<typeof sdkFlagSchema>;

export const sdkSegmentSchema = z.object({
  key: z.string(),
  conditions: z.array(sdkConditionSchema),
});

export type SdkSegment = z.infer<typeof sdkSegmentSchema>;

export const sdkConfigSchema = z.object({
  /**
   * A content hash of the payload, and the response's ETag. The SDK compares it
   * to decide whether a refresh changed anything.
   */
  version: z.string(),
  project: z.object({ key: z.string(), name: z.string() }),
  environment: z.object({ key: z.string(), name: z.string() }),
  /** Ordered by key, so the version is stable for a given database state. */
  flags: z.array(sdkFlagSchema),
  segments: z.array(sdkSegmentSchema),
});

export type SdkConfig = z.infer<typeof sdkConfigSchema>;
