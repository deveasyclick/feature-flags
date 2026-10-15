import type {
  ApiKey,
  ApiKeyKind,
  ApiKeyScope,
  CreatedApiKey,
} from "@iwifunni/contracts";

import type { ApiKeyRow } from "./api-keys.types.js";

export function toApiKey(row: ApiKeyRow): ApiKey {
  return {
    id: row.id,
    projectId: row.projectId,
    environmentId: row.environmentId,
    environmentKey: row.environmentKey,
    kind: row.kind as ApiKeyKind,
    name: row.name,
    scopes: row.scopes as ApiKeyScope[],
    prefix: row.prefix,
    suffix: row.suffix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

/** The only shape that ever carries the secret: create and rotate replies. */
export function toCreatedApiKey(row: ApiKeyRow, secret: string): CreatedApiKey {
  return { ...toApiKey(row), secret };
}
