import type {
  ChangeRequestStatus,
  FlagChangePayload,
} from "@iwifunni/contracts";

import type { Transaction } from "../../shared/types/db.js";

export interface ChangeRequestRow {
  id: string;
  projectId: string;
  environmentId: string;
  flagId: string;
  status: string;
  payload: unknown;
  requestedBy: string;
  requestedByName: string | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A request row joined with the flag and environment its reviewer reads. */
export interface ChangeRequestDetailRow extends ChangeRequestRow {
  flagKey: string;
  environmentKey: string;
  environmentName: string;
}

export interface NewChangeRequestRecord {
  id: string;
  projectId: string;
  environmentId: string;
  flagId: string;
  payload: FlagChangePayload;
  requestedBy: string;
  requestedByName: string | null;
}

export interface ChangeRequestDecision {
  decidedBy: string;
  decidedByName: string | null;
  decisionNote: string | null;
}

/**
 * The list is newest first, so its cursor carries both halves of that order:
 * two requests can share a timestamp, and a cursor on the timestamp alone would
 * then skip or repeat a row.
 */
export interface ChangeRequestCursor {
  createdAt: Date;
  id: string;
}

export interface ChangeRequestListFilter {
  environmentKey?: string;
  status?: ChangeRequestStatus;
  limit: number;
  cursor: ChangeRequestCursor | null;
}

export interface ChangeRequestActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
  userName: string;
}

export const CHANGE_REQUEST_CURSOR_SEPARATOR = "::";

/** Longest accepted decision note, mirroring the wire contract. */
export const DECISION_NOTE_MAX_LENGTH = 280;

/** The change an approver authorises, addressed the way the write endpoints are. */
export interface ApprovedChange {
  projectKey: string;
  flagKey: string;
  environmentKey: string;
  payload: FlagChangePayload;
}

/**
 * How a proposed change is checked and how an approved one reaches the
 * environment. Injected by `app.ts` so this module never imports the flags
 * module, and applied through the caller's transaction so the decision and the
 * change it authorises commit together.
 */
export interface ChangeApplier {
  validate(
    actor: ChangeRequestActorContext,
    change: ApprovedChange,
  ): Promise<void>;
  apply(
    tx: Transaction,
    actor: ChangeRequestActorContext,
    change: ApprovedChange,
  ): Promise<void>;
}
