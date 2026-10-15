import type {
  WorkspaceProfile,
  WorkspaceSecuritySettings,
} from "@iwifunni/contracts";

import {
  DEFAULT_SECURITY_SETTINGS,
  DEFAULT_TIMEZONE,
  type WorkspaceMetadata,
  type WorkspaceRow,
} from "./workspace.types.js";

export function parseMetadata(value: string | null): WorkspaceMetadata {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;

    return parsed && typeof parsed === "object"
      ? (parsed as WorkspaceMetadata)
      : {};
  } catch {
    // A malformed column is treated as empty rather than failing the request.
    return {};
  }
}

export function toWorkspaceProfile(
  row: WorkspaceRow,
  metadata: WorkspaceMetadata,
): WorkspaceProfile {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    defaultEnvironmentId: metadata.defaultEnvironmentId ?? null,
    timezone: metadata.timezone ?? DEFAULT_TIMEZONE,
  };
}

export function toSecuritySettings(
  metadata: WorkspaceMetadata,
): WorkspaceSecuritySettings {
  return { ...DEFAULT_SECURITY_SETTINGS, ...metadata.security };
}
