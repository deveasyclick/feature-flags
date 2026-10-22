import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import { db } from "../../db/client.js";
import {
  environment,
  flag,
  flagEnvironmentConfig,
  segment,
  segmentCondition,
  targetingRule,
} from "../../db/schema/index.js";
import type { TargetingConditionInput } from "@iwifunni/contracts";

import type { Transaction } from "../../shared/types/db.js";
import type {
  NewSegmentRecord,
  SegmentConditionCount,
  SegmentConditionRow,
  SegmentFlagRow,
  SegmentListFilter,
  SegmentRow,
  UpdateSegmentRecord,
} from "./segments.types.js";

export class SegmentsRepository {
  async findProtectedReference(
    projectId: string,
    segmentKey: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ key: environment.key })
      .from(targetingRule)
      .innerJoin(flag, eq(flag.id, targetingRule.flagId))
      .innerJoin(environment, eq(environment.id, targetingRule.environmentId))
      .where(
        and(
          eq(flag.projectId, projectId),
          eq(environment.isProtected, true),
          isNull(environment.archivedAt),
          sql`${targetingRule.segmentKeys} @> array[${segmentKey}]::text[]`,
        ),
      )
      .limit(1);
    return rows[0]?.key ?? null;
  }

  /** Fetches limit + 1 rows so the caller can tell whether another page exists. */
  async list(
    projectId: string,
    filter: SegmentListFilter,
  ): Promise<SegmentRow[]> {
    const conditions = [eq(segment.projectId, projectId)];

    if (!filter.includeArchived) {
      conditions.push(isNull(segment.archivedAt));
    }

    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(
        ilike(segment.key, pattern),
        ilike(segment.name, pattern),
      );

      if (match) conditions.push(match);
    }

    if (filter.cursor) {
      conditions.push(gt(segment.key, filter.cursor));
    }

    return db
      .select()
      .from(segment)
      .where(and(...conditions))
      .orderBy(asc(segment.key))
      .limit(filter.limit + 1);
  }

  async findByKey(projectId: string, key: string): Promise<SegmentRow | null> {
    const rows = await db
      .select()
      .from(segment)
      .where(and(eq(segment.projectId, projectId), eq(segment.key, key)))
      .limit(1);

    return rows[0] ?? null;
  }

  async findManyByKeys(
    projectId: string,
    keys: string[],
  ): Promise<SegmentRow[]> {
    if (keys.length === 0) return [];

    return db
      .select()
      .from(segment)
      .where(and(eq(segment.projectId, projectId), inArray(segment.key, keys)));
  }

  async insert(tx: Transaction, record: NewSegmentRecord): Promise<void> {
    await tx.insert(segment).values(record);
  }

  async update(
    tx: Transaction,
    id: string,
    patch: UpdateSegmentRecord,
  ): Promise<void> {
    await tx
      .update(segment)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(segment.id, id));
  }

  /** Archived, never deleted: targeting rules reference a segment by key. */
  async archive(tx: Transaction, id: string): Promise<Date> {
    const archivedAt = new Date();

    await tx
      .update(segment)
      .set({ archivedAt, updatedAt: archivedAt })
      .where(eq(segment.id, id));

    return archivedAt;
  }

  async listConditions(segmentId: string): Promise<SegmentConditionRow[]> {
    return db
      .select({
        id: segmentCondition.id,
        segmentId: segmentCondition.segmentId,
        attribute: segmentCondition.attribute,
        attributeType: segmentCondition.attributeType,
        operator: segmentCondition.operator,
        values: segmentCondition.values,
        priority: segmentCondition.priority,
      })
      .from(segmentCondition)
      .where(eq(segmentCondition.segmentId, segmentId))
      .orderBy(asc(segmentCondition.priority));
  }

  async countConditions(
    segmentIds: string[],
  ): Promise<SegmentConditionCount[]> {
    if (segmentIds.length === 0) return [];

    const rows = await db
      .select({
        segmentId: segmentCondition.segmentId,
        value: count(),
      })
      .from(segmentCondition)
      .where(inArray(segmentCondition.segmentId, segmentIds))
      .groupBy(segmentCondition.segmentId);

    return rows.map((row) => ({
      segmentId: row.segmentId,
      count: Number(row.value),
    }));
  }

  async replaceConditions(
    tx: Transaction,
    segmentId: string,
    conditions: TargetingConditionInput[],
  ): Promise<void> {
    await tx
      .delete(segmentCondition)
      .where(eq(segmentCondition.segmentId, segmentId));

    if (conditions.length === 0) return;

    await tx.insert(segmentCondition).values(
      conditions.map((condition, index) => ({
        id: randomUUID(),
        segmentId,
        attribute: condition.attribute,
        attributeType: condition.attributeType,
        operator: condition.operator,
        values: condition.values,
        priority: index,
      })),
    );
  }

  /** Flags whose targeting rules reference this segment key, one row per environment that does. */
  async listFlagsReferencing(
    projectId: string,
    segmentKey: string,
  ): Promise<SegmentFlagRow[]> {
    return db
      .select({
        key: flag.key,
        environmentKey: environment.key,
        status: flag.status,
        enabled: flagEnvironmentConfig.enabled,
        rolloutPercentage: flagEnvironmentConfig.rolloutPercentage,
        ruleRolloutPercentage: targetingRule.rolloutPercentage,
      })
      .from(targetingRule)
      .innerJoin(flag, eq(flag.id, targetingRule.flagId))
      .innerJoin(environment, eq(environment.id, targetingRule.environmentId))
      .innerJoin(
        flagEnvironmentConfig,
        and(
          eq(flagEnvironmentConfig.flagId, flag.id),
          eq(flagEnvironmentConfig.environmentId, targetingRule.environmentId),
        ),
      )
      .where(
        and(
          eq(flag.projectId, projectId),
          sql`${targetingRule.segmentKeys} @> array[${segmentKey}]::text[]`,
        ),
      )
      .orderBy(asc(flag.key), asc(environment.key));
  }
}
