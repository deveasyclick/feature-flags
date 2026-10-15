import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

import type {
  ApiKey,
  ApiKeyKind,
  ApiKeyListQuery,
  ApiKeyScope,
  CreateApiKeyInput,
  CreatedApiKey,
  UpdateApiKeyInput,
} from "@iwifunni/contracts";
import {
  API_KEY_SUFFIX_LENGTH,
  MANAGEMENT_API_KEY_SCOPES,
  SDK_API_KEY_SCOPES,
} from "@iwifunni/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { Page } from "../../shared/types/pagination.js";
import type { ProjectAccessService } from "../project-access/index.js";
import { toApiKey, toCreatedApiKey } from "./api-keys.mapper.js";
import type { ApiKeysRepository } from "./api-keys.repository.js";
import {
  API_KEY_LAST_USED_THROTTLE_MS,
  API_KEY_PREFIX_BYTES,
  API_KEY_SECRET_BYTES,
  DEFAULT_API_KEY_KIND,
  type ApiKeyAccessContext,
  type ApiKeyActorContext,
  type EnvironmentRef,
} from "./api-keys.types.js";

const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_PREFIX_ATTEMPTS = 5;

/** True when the list is exactly the read-only scope an SDK key may carry. */
function isSdkScopeList(scopes: ApiKeyScope[]): boolean {
  return (
    scopes.length === SDK_API_KEY_SCOPES.length &&
    SDK_API_KEY_SCOPES.every((scope) => scopes.includes(scope))
  );
}

/** The scopes a key holds when the caller does not name them. */
function defaultScopesFor(kind: ApiKeyKind): ApiKeyScope[] {
  return kind === "management"
    ? [...MANAGEMENT_API_KEY_SCOPES]
    : [...SDK_API_KEY_SCOPES];
}

/** The non-secret tail the dashboard masks the key with. */
function suffixOf(secret: string): string {
  return secret.slice(-API_KEY_SUFFIX_LENGTH);
}

/**
 * Listing is viewer-level; issuing and revoking a key is admin-level per the
 * role matrix in docs/architecture.md §3. Only a hash of the secret is ever
 * stored, and the secret itself appears once, in the create response.
 */
export class ApiKeysService {
  constructor(
    private readonly repository: ApiKeysRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async list(
    context: ApiKeyActorContext,
    projectKey: string,
    query: ApiKeyListQuery,
  ): Promise<Page<ApiKey>> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    const environment = query.environmentKey
      ? await this.requireEnvironment(project.id, query.environmentKey)
      : null;

    const rows = await this.repository.list(project.id, {
      environmentId: environment?.id ?? null,
      includeRevoked: query.includeRevoked ?? false,
      limit: query.limit,
      cursor: decodeCursor(query.cursor),
    });

    const page = toPage(rows, query.limit, (row) => row.prefix);

    return {
      data: page.data.map(toApiKey),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Authenticate a secret, or answer `null`.
   *
   * The prefix narrows the lookup — it is unique, so one row can match — and the
   * digest comparison decides in constant time. Revoked, expired and unknown
   * keys all answer `null`: telling them apart would confirm a secret that is
   * already dead, and the caller only needs to know it did not authenticate.
   */
  async resolveApiKey(secret: string): Promise<ApiKeyAccessContext | null> {
    const separator = secret.indexOf(".");

    if (separator <= 0) return null;

    const row = await this.repository.findForAuthByPrefix(
      secret.slice(0, separator),
    );

    if (!row) return null;

    const presented = Buffer.from(this.hashSecret(secret), "hex");
    const stored = Buffer.from(row.secretHash, "hex");

    if (
      presented.length !== stored.length ||
      !timingSafeEqual(presented, stored)
    ) {
      return null;
    }

    if (row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

    await this.repository.touchLastUsed(row.id, API_KEY_LAST_USED_THROTTLE_MS);

    return {
      apiKeyId: row.id,
      kind: row.kind as ApiKeyKind,
      scopes: row.scopes as ApiKeyScope[],
      organizationId: row.organizationId,
      projectId: row.projectId,
      projectKey: row.projectKey,
      environmentId: row.environmentId,
      environmentKey: row.environmentKey,
    };
  }

  async create(
    context: ApiKeyActorContext,
    projectKey: string,
    input: CreateApiKeyInput,
  ): Promise<CreatedApiKey> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    let environmentId: string | null = null;

    if (input.environmentKey) {
      const environment = await this.repository.findEnvironmentByKey(
        project.id,
        input.environmentKey,
      );

      if (!environment) {
        throw ApiError.badRequest(
          `"${input.environmentKey}" is not an environment of this project.`,
        );
      }

      environmentId = environment.id;
    }

    const kind: ApiKeyKind = input.kind ?? DEFAULT_API_KEY_KIND;
    // The set follows the kind unless the caller narrowed it, so the dashboard
    // never has to send one and a key cannot claim scopes its kind forbids.
    const scopes = input.scopes ?? defaultScopesFor(kind);

    if (kind !== "management") {
      // An SDK key is a runtime credential: one environment, read-only. Both
      // rules are enforced here rather than trusted from the caller, so a
      // browser or CI key can never manage anything.
      if (!environmentId) {
        throw ApiError.badRequest("An SDK key is issued for one environment.");
      }

      if (!isSdkScopeList(scopes)) {
        throw ApiError.badRequest(
          `An SDK key may only carry the ${SDK_API_KEY_SCOPES.join(", ")} scope.`,
        );
      }
    }

    const { prefix, secret } = await this.allocate();
    const id = randomUUID();
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * MILLISECONDS_PER_DAY)
      : null;

    await db.transaction(async (tx) => {
      await this.repository.insert(tx, {
        id,
        projectId: project.id,
        environmentId,
        kind,
        name: input.name,
        prefix,
        suffix: suffixOf(secret),
        secretHash: this.hashSecret(secret),
        scopes,
        expiresAt,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "api_key.created",
        target: id,
        // Never the secret, and never the hash.
        changes: {
          name: input.name,
          kind,
          prefix,
          scopes,
          environmentKey: input.environmentKey ?? null,
          expiresAt: expiresAt?.toISOString() ?? null,
        },
      });
    });

    const row = await this.requireKey(project.id, id);

    return toCreatedApiKey(row, secret);
  }

  /** Idempotent: revoking an already-revoked key changes nothing and adds no audit row. */
  async revoke(
    context: ApiKeyActorContext,
    projectKey: string,
    keyId: string,
  ): Promise<ApiKey> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireKey(project.id, keyId);

    if (row.revokedAt) {
      return toApiKey(row);
    }

    await db.transaction(async (tx) => {
      await this.repository.revoke(tx, row.id);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "api_key.revoked",
        target: row.id,
        changes: { prefix: row.prefix },
      });
    });

    return toApiKey(await this.requireKey(project.id, keyId));
  }

  /**
   * Rename a key. Identity only: the prefix, the secret and its hash are
   * untouched, because they are what the key already authenticates with.
   */
  async rename(
    context: ApiKeyActorContext,
    projectKey: string,
    keyId: string,
    input: UpdateApiKeyInput,
  ): Promise<ApiKey> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireKey(project.id, keyId);

    await db.transaction(async (tx) => {
      await this.repository.updateName(tx, row.id, input.name);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "api_key.updated",
        target: row.id,
        changes: { prefix: row.prefix, from: row.name, to: input.name },
      });
    });

    return toApiKey(await this.requireKey(project.id, keyId));
  }

  /**
   * Issue a new secret for an existing key, keeping its rows and its prefix.
   *
   * The old secret stops working the moment the hash is replaced, which is the
   * point: this is the response to a leak. A revoked key cannot be rotated back
   * to life, so it is refused.
   */
  async rotate(
    context: ApiKeyActorContext,
    projectKey: string,
    keyId: string,
  ): Promise<CreatedApiKey> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "admin",
    });

    const row = await this.requireKey(project.id, keyId);

    if (row.revokedAt) {
      throw ApiError.conflict(
        "That key is revoked. Create a new one instead.",
      );
    }

    const secret = this.secretFor(row.prefix);

    await db.transaction(async (tx) => {
      await this.repository.replaceSecret(
        tx,
        row.id,
        this.hashSecret(secret),
        suffixOf(secret),
      );

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        environmentId: row.environmentId,
        actor: context.userId,
        actorName: context.userName,
        action: "api_key.rotated",
        target: row.id,
        // Never the secret, and never the hash.
        changes: { prefix: row.prefix },
      });
    });

    return toCreatedApiKey(await this.requireKey(project.id, keyId), secret);
  }

  private async allocate(): Promise<{ prefix: string; secret: string }> {
    for (let attempt = 0; attempt < MAX_PREFIX_ATTEMPTS; attempt += 1) {
      const prefix = `ff_${randomBytes(API_KEY_PREFIX_BYTES).toString("hex")}`;

      if (!(await this.repository.prefixExists(prefix))) {
        return { prefix, secret: this.secretFor(prefix) };
      }
    }

    throw ApiError.conflict(
      "Could not allocate a unique key prefix. Please try again.",
    );
  }

  /**
   * A fresh secret for a prefix. The separator is `.` on purpose: the random
   * body is base64url, which can itself contain `_`, so an underscore would make
   * the prefix ambiguous to read back.
   */
  private secretFor(prefix: string): string {
    return `${prefix}.${randomBytes(API_KEY_SECRET_BYTES).toString("base64url")}`;
  }

  private hashSecret(secret: string): string {
    return createHash("sha256").update(secret).digest("hex");
  }

  private async requireKey(projectId: string, id: string) {
    const row = await this.repository.findById(projectId, id);

    if (!row) {
      throw ApiError.notFound("API key not found.");
    }

    return row;
  }

  /**
   * The filter names an environment the project does not have, so the request
   * addresses something that does not exist rather than listing nothing.
   */
  private async requireEnvironment(
    projectId: string,
    environmentKey: string,
  ): Promise<EnvironmentRef> {
    const environment = await this.repository.findEnvironmentByKey(
      projectId,
      environmentKey,
    );

    if (!environment) {
      throw ApiError.notFound("Environment not found.");
    }

    return environment;
  }
}
