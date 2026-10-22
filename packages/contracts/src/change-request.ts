import { z } from "zod";

import { environmentKeySchema } from "#environment";
import {
  replaceIndividualTargetsSchema,
  replaceTargetingRulesSchema,
  updateFlagConfigSchema,
  flagVersionSchema,
} from "#flag";
import { paginatedSchema, paginationQuerySchema } from "#pagination";
import { resourceKeySchema } from "#slug";

export const CHANGE_REQUEST_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "superseded",
] as const;

export const changeRequestStatusSchema = z.enum(CHANGE_REQUEST_STATUSES);

export type ChangeRequestStatus = z.infer<typeof changeRequestStatusSchema>;

/**
 * The proposed change, in the same shapes the direct write endpoints take.
 *
 * Every part is optional because the two editors propose different halves of
 * an environment's state: the configuration screen sends `config`, the
 * targeting screen sends `rules` and `targets`. Approving applies only the
 * parts that are present, so neither editor can silently clear the other's.
 *
 * The response type is deliberately permissive — a request that cannot be read
 * back is reported as an empty payload rather than breaking the whole list —
 * so the requirement that a proposal carry something lives on the create
 * schema instead.
 */
export const flagChangePayloadSchema = z.object({
  config: updateFlagConfigSchema.optional(),
  rules: replaceTargetingRulesSchema.optional(),
  targets: replaceIndividualTargetsSchema.optional(),
});

export type FlagChangePayload = z.infer<typeof flagChangePayloadSchema>;

export const flagReleaseStateSchema = z.object({
  config: updateFlagConfigSchema,
  rules: replaceTargetingRulesSchema,
  targets: replaceIndividualTargetsSchema,
});

export type FlagReleaseState = z.infer<typeof flagReleaseStateSchema>;

export const flagVersionDetailSchema = flagVersionSchema.extend({
  state: flagReleaseStateSchema.nullable(),
});

export type FlagVersionDetail = z.infer<typeof flagVersionDetailSchema>;

export const flagVersionNumberSchema = z.coerce.number().int().positive().max(2147483647);

export const scheduledFlagChangeSchema = z.object({
  id: z.string().uuid(),
  executeAt: z.iso.datetime({ offset: true }),
  status: z.enum(["pending", "completed", "failed", "cancelled"]),
  baseVersion: z.number().int().positive(),
  payload: flagChangePayloadSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
});

export type ScheduledFlagChange = z.infer<typeof scheduledFlagChangeSchema>;

export const scheduledFlagChangeIdSchema = z.string().uuid();

export function payloadProposesChange(payload: FlagChangePayload): boolean {
  return (
    payload.config !== undefined ||
    payload.rules !== undefined ||
    payload.targets !== undefined
  );
}

export const proposeFlagChangeSchema = flagChangePayloadSchema.check((ctx) => {
  if (!payloadProposesChange(ctx.value)) {
    ctx.issues.push({
      code: "custom",
      input: ctx.value,
      message: "A change request must propose a change.",
    });
  }
});

export const scheduleFlagChangeSchema = z.object({
  executeAt: z.iso.datetime({ offset: true }),
  baseVersion: flagVersionNumberSchema,
  payload: proposeFlagChangeSchema,
});

export type ScheduleFlagChangeInput = z.infer<typeof scheduleFlagChangeSchema>;

export const armFlagRollbackSchema = z.object({
  currentVersion: flagVersionNumberSchema,
  targetVersion: flagVersionNumberSchema,
  errorPercentage: z.number().min(1).max(100),
  minimumSamples: z.number().int().min(10).max(100000),
  windowMinutes: z.number().int().min(1).max(60),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export type ArmFlagRollbackInput = z.infer<typeof armFlagRollbackSchema>;
export const flagRollbackPolicySchema = armFlagRollbackSchema.extend({
  id: z.string().uuid(), status: z.enum(["armed", "triggered", "cancelled", "blocked", "expired"]),
  armedAt: z.string(), expiresAt: z.string(), finishedAt: z.string().nullable(), reason: z.string().nullable(),
});
export type FlagRollbackPolicy = z.infer<typeof flagRollbackPolicySchema>;

export const flagChangeRequestSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  flagId: z.string(),
  flagKey: z.string(),
  environmentId: z.string(),
  environmentKey: z.string(),
  environmentName: z.string(),
  status: changeRequestStatusSchema,
  payload: flagChangePayloadSchema,
  requestedBy: z.string(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  decidedBy: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  /**
   * Whether the caller may decide this request: an admin or owner on the
   * project, and never the person who proposed it. Computed per request so the
   * dashboard can hide a button the API would refuse.
   */
  canDecide: z.boolean(),
});

export type FlagChangeRequest = z.infer<typeof flagChangeRequestSchema>;

export const createFlagChangeRequestSchema = z.object({
  environmentKey: environmentKeySchema,
  payload: proposeFlagChangeSchema,
});

export type CreateFlagChangeRequestInput = z.infer<
  typeof createFlagChangeRequestSchema
>;

export const decideFlagChangeRequestSchema = z.object({
  note: z
    .string()
    .trim()
    .max(280, "A decision note must be at most 280 characters.")
    .nullable()
    .optional(),
});

export type DecideFlagChangeRequestInput = z.infer<
  typeof decideFlagChangeRequestSchema
>;

export const flagChangeRequestListQuerySchema = paginationQuerySchema.extend({
  environmentKey: resourceKeySchema.optional(),
  status: changeRequestStatusSchema.optional(),
});

export type FlagChangeRequestListQuery = z.infer<
  typeof flagChangeRequestListQuerySchema
>;

export const flagChangeRequestPageSchema = paginatedSchema(
  flagChangeRequestSchema,
);

export type FlagChangeRequestPage = z.infer<typeof flagChangeRequestPageSchema>;
