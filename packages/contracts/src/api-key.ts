import { z } from "zod";

import { environmentKeySchema } from "#environment";
import { paginationQuerySchema } from "#pagination";
import { booleanQueryParamSchema } from "#query";

export const API_KEY_SCOPES = [
  "flags:read",
  "events:write",
  "flags:write",
  "segments:read",
  "webhooks:manage",
] as const;

export const apiKeyScopeSchema = z.enum(API_KEY_SCOPES);

export type ApiKeyScope = z.infer<typeof apiKeyScopeSchema>;

export const API_KEY_KINDS = ["management", "server", "client"] as const;

export const apiKeyKindSchema = z.enum(API_KEY_KINDS);

export type ApiKeyKind = z.infer<typeof apiKeyKindSchema>;

/**
 * The kinds an SDK key may take.
 *
 * Both are runtime credentials: one environment's configuration is read and
 * evaluated, and nothing is ever written. `server` is for a server-side SDK,
 * `client` for one that ships to a browser. `management` is the dashboard's
 * credential and is deliberately not an SDK kind.
 */
export const SDK_API_KEY_KINDS = ["server", "client"] as const;

export const sdkApiKeyKindSchema = z.enum(SDK_API_KEY_KINDS);

export type SdkApiKeyKind = z.infer<typeof sdkApiKeyKindSchema>;

export const SDK_API_KEY_SCOPES: ApiKeyScope[] = ["flags:read"];
export const SDK_ALLOWED_SCOPES: ApiKeyScope[] = ["flags:read", "events:write"];

/**
 * What a management key carries.
 *
 * The dashboard does not ask: a management key is the credential for driving the
 * API, so it records every management scope, and the server assigns the set from
 * the kind rather than trusting the caller.
 */
export const MANAGEMENT_API_KEY_SCOPES: ApiKeyScope[] = [...API_KEY_SCOPES];

/** How many characters of the secret are kept, so the dashboard can mask it. */
export const API_KEY_SUFFIX_LENGTH = 4;

/**
 * Key metadata as the dashboard lists it.
 *
 * The secret itself is deliberately absent; it appears once, in the create or
 * rotate response, and only its hash is stored. `prefix` and `suffix` are the
 * two non-secret ends the list renders as `ff_a1b2*****3d4e`.
 */
export const apiKeySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** `null` when the key is valid in every environment. */
  environmentId: z.string().nullable(),
  environmentKey: z.string().nullable(),
  kind: apiKeyKindSchema,
  name: z.string(),
  scopes: z.array(apiKeyScopeSchema),
  /** Non-secret identifier shown in the dashboard, e.g. `ff_prod_8a2c`. */
  prefix: z.string(),
  /** The secret's last characters, also non-secret, for the masked label. */
  suffix: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
});

export type ApiKey = z.infer<typeof apiKeySchema>;

export const createApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Key name is required.")
    .max(80, "Key name must be at most 80 characters."),
  /** The environment key, not its id; `null` means every environment. */
  environmentKey: environmentKeySchema.nullable().optional(),
  /**
   * Defaults to `management`, the dashboard's credential. `server` and `client`
   * are runtime SDK keys: they require an environment and flags:read.
   */
  kind: apiKeyKindSchema.optional(),
  /**
   * Omissible: the server assigns the set the kind implies — every management
   * scope, or flags:read for an SDK key. SDK keys may add events:write.
   */
  scopes: z
    .array(apiKeyScopeSchema)
    .min(1, "Choose at least one scope.")
    .max(API_KEY_SCOPES.length)
    .optional(),
  /** `null` issues a key that never expires. */
  expiresInDays: z
    .number()
    .int()
    .positive("Expiry must be at least one day.")
    .nullable()
    .optional(),
});

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;

/** `PATCH /v1/projects/:projectKey/api-keys/:keyId`, an identity edit only. */
export const updateApiKeySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Key name is required.")
    .max(80, "Key name must be at most 80 characters."),
});

export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;

/**
 * The create and rotate responses: the only two places `secret` is ever
 * returned, and the only two moments the dashboard can show it.
 */
export const createdApiKeySchema = apiKeySchema.extend({
  secret: z.string(),
});

export type CreatedApiKey = z.infer<typeof createdApiKeySchema>;

export const apiKeyListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().max(200).optional(),
  includeRevoked: booleanQueryParamSchema.optional(),
  /**
   * Narrows the list to one environment. Keys issued without an environment are
   * included, because those work in every environment the project has.
   */
  environmentKey: environmentKeySchema.optional(),
});

export type ApiKeyListQuery = z.infer<typeof apiKeyListQuerySchema>;
