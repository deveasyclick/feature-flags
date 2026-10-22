import { and, asc, eq, gt, isNull, lt, or, ilike } from "drizzle-orm";

import { db } from "../../db/client.js";
import { apiKey, environment, project } from "../../db/schema/index.js";
import type { Transaction } from "../../shared/types/db.js";
import type {
  ApiKeyAuthRow,
  ApiKeyListFilter,
  ApiKeyRow,
  EnvironmentRef,
  NewApiKeyRecord,
} from "./api-keys.types.js";

const keyColumns = {
  id: apiKey.id,
  projectId: apiKey.projectId,
  environmentId: apiKey.environmentId,
  environmentKey: environment.key,
  kind: apiKey.kind,
  name: apiKey.name,
  prefix: apiKey.prefix,
  suffix: apiKey.suffix,
  scopes: apiKey.scopes,
  createdAt: apiKey.createdAt,
  lastUsedAt: apiKey.lastUsedAt,
  expiresAt: apiKey.expiresAt,
  revokedAt: apiKey.revokedAt,
};

export class ApiKeysRepository {
  /** Fetches limit + 1 rows so the caller can tell whether another page exists. */
  async list(
    projectId: string,
    filter: ApiKeyListFilter,
  ): Promise<ApiKeyRow[]> {
    const conditions = [eq(apiKey.projectId, projectId)];
    if (filter.search) {
      const term = `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`;
      const match = or(ilike(apiKey.name, term), ilike(apiKey.prefix, term));
      if (match) conditions.push(match);
    }

    if (filter.environmentId) {
      // A key issued without an environment authenticates in every one, so it
      // belongs to each environment's list as much as its own keys do.
      const inEnvironment = or(
        eq(apiKey.environmentId, filter.environmentId),
        isNull(apiKey.environmentId),
      );

      if (inEnvironment) conditions.push(inEnvironment);
    }

    if (!filter.includeRevoked) {
      conditions.push(isNull(apiKey.revokedAt));
    }

    if (filter.cursor) {
      conditions.push(gt(apiKey.prefix, filter.cursor));
    }

    return db
      .select(keyColumns)
      .from(apiKey)
      .leftJoin(environment, eq(environment.id, apiKey.environmentId))
      .where(and(...conditions))
      .orderBy(asc(apiKey.prefix))
      .limit(filter.limit + 1);
  }

  /**
   * A key by its non-secret prefix, with the project and environment it is
   * scoped to. The prefix is unique, so at most one row can match.
   */
  async findForAuthByPrefix(prefix: string): Promise<ApiKeyAuthRow | null> {
    const rows = await db
      .select({
        id: apiKey.id,
        kind: apiKey.kind,
        scopes: apiKey.scopes,
        secretHash: apiKey.secretHash,
        revokedAt: apiKey.revokedAt,
        expiresAt: apiKey.expiresAt,
        projectId: apiKey.projectId,
        projectKey: project.key,
        organizationId: project.organizationId,
        environmentId: apiKey.environmentId,
        environmentKey: environment.key,
      })
      .from(apiKey)
      .innerJoin(project, eq(project.id, apiKey.projectId))
      .leftJoin(environment, eq(environment.id, apiKey.environmentId))
      .where(and(eq(apiKey.prefix, prefix), isNull(project.archivedAt)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Stamps a key as used, at most once per throttle window. An SDK evaluates on
   * every request, and a write per read would make the read path a write path.
   */
  async touchLastUsed(id: string, throttleMs: number): Promise<void> {
    const cutoff = new Date(Date.now() - throttleMs);

    await db
      .update(apiKey)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKey.id, id),
          or(isNull(apiKey.lastUsedAt), lt(apiKey.lastUsedAt, cutoff)),
        ),
      );
  }

  async findById(projectId: string, id: string): Promise<ApiKeyRow | null> {
    const rows = await db
      .select(keyColumns)
      .from(apiKey)
      .leftJoin(environment, eq(environment.id, apiKey.environmentId))
      .where(and(eq(apiKey.projectId, projectId), eq(apiKey.id, id)))
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Resolves an environment key inside the project. The `environment` table is
   * reached from `db/schema` like every other table, so this stays a plain
   * foreign-key lookup rather than a second module dependency.
   */
  async findEnvironmentByKey(
    projectId: string,
    key: string,
  ): Promise<EnvironmentRef | null> {
    const rows = await db
      .select({ id: environment.id, key: environment.key })
      .from(environment)
      .where(
        and(eq(environment.projectId, projectId), eq(environment.key, key)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async prefixExists(prefix: string): Promise<boolean> {
    const rows = await db
      .select({ id: apiKey.id })
      .from(apiKey)
      .where(eq(apiKey.prefix, prefix))
      .limit(1);

    return rows.length > 0;
  }

  async insert(tx: Transaction, record: NewApiKeyRecord): Promise<void> {
    await tx.insert(apiKey).values(record);
  }

  /** An identity edit: the secret, its hash and the prefix are not touched. */
  async updateName(tx: Transaction, id: string, name: string): Promise<void> {
    await tx.update(apiKey).set({ name }).where(eq(apiKey.id, id));
  }

  /**
   * Replaces the secret behind a key. The prefix stays, so the identifier the
   * dashboard and the audit log quote keeps pointing at the same row.
   */
  async replaceSecret(
    tx: Transaction,
    id: string,
    secretHash: string,
    suffix: string,
  ): Promise<void> {
    await tx
      .update(apiKey)
      .set({ secretHash, suffix })
      .where(eq(apiKey.id, id));
  }

  /** Sets `revokedAt` only when it is still null, so repeat calls are no-ops. */
  async revoke(tx: Transaction, id: string): Promise<boolean> {
    const revoked = await tx
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKey.id, id), isNull(apiKey.revokedAt)))
      .returning({ id: apiKey.id });

    return revoked.length > 0;
  }
}
