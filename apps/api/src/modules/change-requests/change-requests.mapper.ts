import {
  CHANGE_REQUEST_STATUSES,
  changeRequestStatusSchema,
  flagChangePayloadSchema,
  type ChangeRequestStatus,
  type FlagChangePayload,
  type FlagChangeRequest,
} from "@iwifunni/contracts";

import type { ChangeRequestDetailRow } from "./change-requests.types.js";

/**
 * The payload column is jsonb, so it is validated as it crosses out of the
 * database: a row written under an older contract must not reach a client as a
 * change the API would refuse to apply.
 *
 * `null` means the row cannot be read back at all, which approving must refuse
 * rather than treat as "nothing to do".
 */
export function parseChangePayload(value: unknown): FlagChangePayload | null {
  const parsed = flagChangePayloadSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

export function toChangeRequest(
  row: ChangeRequestDetailRow,
  canDecide: boolean,
): FlagChangeRequest {
  return {
    id: row.id,
    projectId: row.projectId,
    flagId: row.flagId,
    flagKey: row.flagKey,
    environmentId: row.environmentId,
    environmentKey: row.environmentKey,
    environmentName: row.environmentName,
    status: toStatus(row.status),
    // An unreadable payload reads as empty rather than failing the whole list.
    payload: parseChangePayload(row.payload) ?? {},
    requestedBy: row.requestedBy,
    requestedByName: row.requestedByName,
    requestedAt: row.createdAt.toISOString(),
    decidedBy: row.decidedBy,
    decidedByName: row.decidedByName,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    canDecide,
  };
}

/** `status` is a text column; the contract's enum is the domain. */
function toStatus(value: string): ChangeRequestStatus {
  const parsed = changeRequestStatusSchema.safeParse(value);

  return parsed.success
    ? parsed.data
    : (CHANGE_REQUEST_STATUSES[0] ?? "pending");
}
