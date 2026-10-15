import type {
  ApiKeyKind,
  ApiKeyScope,
  SdkApiKeyKind,
} from "@iwifunni/contracts";

export interface ApiKeyRow {
  id: string;
  projectId: string;
  environmentId: string | null;
  environmentKey: string | null;
  kind: string;
  name: string;
  prefix: string;
  suffix: string;
  scopes: string[];
  createdAt: Date;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface NewApiKeyRecord {
  id: string;
  projectId: string;
  environmentId: string | null;
  kind: ApiKeyKind;
  name: string;
  prefix: string;
  suffix: string;
  secretHash: string;
  scopes: ApiKeyScope[];
  expiresAt: Date | null;
}

export interface ApiKeyListFilter {
  /**
   * Narrows the list to one environment, keeping the project-wide keys that
   * work in it. `null` lists every key of the project.
   */
  environmentId: string | null;
  includeRevoked: boolean;
  limit: number;
  cursor: string | null;
}

export interface EnvironmentRef {
  id: string;
  key: string;
}

export interface ApiKeyActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
  userName: string;
}

/** The kind a key is issued as when the caller does not ask for one. */
export const DEFAULT_API_KEY_KIND: ApiKeyKind = "management";

/**
 * A credential the SDK surface authenticated, with everything the request needs
 * to be scoped: the tenant, the project, and the environment it was issued into.
 */
export interface ApiKeyAccessContext {
  apiKeyId: string;
  kind: ApiKeyKind;
  scopes: ApiKeyScope[];
  organizationId: string;
  projectId: string;
  projectKey: string;
  /** `null` for a management key that works in every environment. */
  environmentId: string | null;
  environmentKey: string | null;
}

/** A key row plus the project and environment it resolves against. */
export interface ApiKeyAuthRow {
  id: string;
  kind: string;
  scopes: string[];
  secretHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
  projectId: string;
  projectKey: string;
  organizationId: string;
  environmentId: string | null;
  environmentKey: string | null;
}

/**
 * Injected by `app.ts`: the middleware authenticates a secret without owning a
 * query of its own, the way `SessionResolver` resolves a session.
 */
export type ApiKeyResolver = (
  secret: string,
) => Promise<ApiKeyAccessContext | null>;

/** The kinds that may be issued as a runtime SDK credential. */
export const SDK_KINDS: readonly SdkApiKeyKind[] = ["server", "client"];

/** Bytes of randomness in the non-secret identifier, matching `ff_` + 8 hex. */
export const API_KEY_PREFIX_BYTES = 4;
export const API_KEY_SECRET_BYTES = 24;

/** A key is stamped as used at most this often, so reads do not write per call. */
export const API_KEY_LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
