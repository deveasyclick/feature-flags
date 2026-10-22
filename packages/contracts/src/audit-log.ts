import { z } from "zod";

import { paginationQuerySchema } from "#pagination";

export const AUDIT_ACTIONS = [
  "project.created",
  "project.updated",
  "project.archived",
  "project.restored",
  "project.duplicated",
  "project.transferred",
  "project.deleted",
  "environment.created",
  "environment.updated",
  "environment.archived",
  "change_request.created",
  "change_request.approved",
  "change_request.rejected",
  "environment.unarchived",
  "flag.created",
  "flag.updated",
  "flag.change_scheduled",
  "flag.schedule_cancelled",
  "flag.schedule_failed",
  "flag.automatically_rolled_back",
  "flag.enabled",
  "flag.disabled",
  "flag.archived",
  "flag.unarchived",
  "flag.variation.added",
  "flag.variation.updated",
  "flag.variation.removed",
  "rollout.updated",
  "segment.created",
  "segment.updated",
  "segment.archived",
  "api_key.created",
  "api_key.updated",
  "api_key.rotated",
  "api_key.revoked",
  "project_member.added",
  "project_member.updated",
  "project_member.removed",
] as const;

export const auditActionSchema = z.enum(AUDIT_ACTIONS);

export type AuditAction = z.infer<typeof auditActionSchema>;

export const auditLogEntrySchema = z.object({
  id: z.string(),
  projectId: z.string().nullable(),
  /** Resolved for the workspace-wide list, which renders outside a project. */
  projectKey: z.string().nullable(),
  environmentId: z.string().nullable(),
  action: auditActionSchema,
  /** A user id or an API key id. */
  actor: z.string(),
  /** Null on rows written before the name was snapshotted. */
  actorName: z.string().nullable(),
  target: z.string().nullable(),
  changes: z.unknown().nullable(),
  createdAt: z.string(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditLogQuerySchema = paginationQuerySchema.extend({
  environmentId: z.string().optional(),
  actor: z.string().optional(),
  action: z.string().optional(),
  /** ISO timestamps, inclusive lower bound and exclusive upper bound. */
  from: z.string().optional(),
  to: z.string().optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
