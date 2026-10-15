import { SDK_API_KEY_KINDS } from "@iwifunni/contracts";
import { and, asc, count, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import { db } from "../../db/client.js";
import { apiKey, environment } from "../../db/schema/index.js";
import type { Transaction } from "../../shared/types/db.js";
import type {
  EnvironmentDetails,
  EnvironmentRow,
  NewEnvironmentRecord,
} from "./environments.types.js";

export class EnvironmentsRepository {
  /** Fetches limit + 1 rows so the caller can tell whether another page exists. */
  async list(
    projectId: string,
    limit: number,
    cursor: string | null,
    includeArchived = false,
  ): Promise<EnvironmentRow[]> {
    const conditions = [eq(environment.projectId, projectId)];

    if (!includeArchived) {
      conditions.push(isNull(environment.archivedAt));
    }

    if (cursor) {
      conditions.push(gt(environment.key, cursor));
    }

    return db
      .select()
      .from(environment)
      .where(and(...conditions))
      .orderBy(asc(environment.key))
      .limit(limit + 1);
  }

  /**
   * Active environments, in key order. An archived environment is out of
   * service, so it is not offered as a flag's source.
   */
  async listAll(projectId: string): Promise<EnvironmentRow[]> {
    return db
      .select()
      .from(environment)
      .where(
        and(
          eq(environment.projectId, projectId),
          isNull(environment.archivedAt),
        ),
      )
      .orderBy(asc(environment.key));
  }

  /**
   * The same read inside a transaction, so archive sees its own writes and the
   * "one environment stays active" invariant is checked against committed state.
   */
  async listActiveInTransaction(
    tx: Transaction,
    projectId: string,
  ): Promise<EnvironmentRow[]> {
    return tx
      .select()
      .from(environment)
      .where(
        and(
          eq(environment.projectId, projectId),
          isNull(environment.archivedAt),
        ),
      )
      .orderBy(asc(environment.key));
  }

  async findByKey(
    projectId: string,
    key: string,
  ): Promise<EnvironmentRow | null> {
    const rows = await db
      .select()
      .from(environment)
      .where(
        and(eq(environment.projectId, projectId), eq(environment.key, key)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async countForProject(projectId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(environment)
      .where(eq(environment.projectId, projectId));

    return row?.value ?? 0;
  }

  async insert(tx: Transaction, record: NewEnvironmentRecord): Promise<void> {
    await tx.insert(environment).values(record);
  }

  async setProtected(
    tx: Transaction,
    id: string,
    isProtected: boolean,
  ): Promise<void> {
    await tx
      .update(environment)
      .set({ isProtected, updatedAt: new Date() })
      .where(eq(environment.id, id));
  }

  async updateDetails(
    tx: Transaction,
    id: string,
    details: EnvironmentDetails,
  ): Promise<void> {
    await tx
      .update(environment)
      .set({ ...details, updatedAt: new Date() })
      .where(eq(environment.id, id));
  }

  async setArchived(
    tx: Transaction,
    id: string,
    archivedAt: Date | null,
  ): Promise<void> {
    await tx
      .update(environment)
      .set({ archivedAt, updatedAt: new Date() })
      .where(eq(environment.id, id));
  }

  async setDefault(
    tx: Transaction,
    id: string,
    isDefault: boolean,
  ): Promise<void> {
    await tx
      .update(environment)
      .set({ isDefault, updatedAt: new Date() })
      .where(eq(environment.id, id));
  }

  /**
   * Archiving withdraws an environment's credentials. Project-wide keys are
   * left alone: they were never scoped to this environment in the first place.
   */
  async revokeKeysForEnvironment(
    tx: Transaction,
    environmentId: string,
  ): Promise<number> {
    const revoked = await tx
      .update(apiKey)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(apiKey.environmentId, environmentId), isNull(apiKey.revokedAt)),
      )
      .returning({ id: apiKey.id });

    return revoked.length;
  }

  /**
   * The most recent usable **SDK** key for the connection preview:
   * environment-specific keys first, then workspace-wide ones. Only the prefix
   * is ever read.
   *
   * The kinds are restricted because the SDKs screen pairs this prefix with the
   * install snippets: a management key's prefix there would invite somebody to
   * paste a credential that cannot call the SDK endpoint at all.
   */
  async findUsableKeyPrefix(
    projectId: string,
    environmentId: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ prefix: apiKey.prefix })
      .from(apiKey)
      .where(
        and(
          eq(apiKey.projectId, projectId),
          or(
            eq(apiKey.environmentId, environmentId),
            isNull(apiKey.environmentId),
          ),
          inArray(apiKey.kind, [...SDK_API_KEY_KINDS]),
          isNull(apiKey.revokedAt),
        ),
      )
      .orderBy(desc(apiKey.createdAt))
      .limit(1);

    return rows[0]?.prefix ?? null;
  }
}
