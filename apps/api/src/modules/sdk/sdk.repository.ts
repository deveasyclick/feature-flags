import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "../../db/client.js";
import type { Transaction } from "../../shared/types/db.js";
import {
  environment,
  flag,
  flagEnvironmentConfig,
  flagIndividualTarget,
  flagVariation,
  flagVersion,
  project,
  segment,
  segmentCondition,
  targetingCondition,
  targetingRule,
} from "../../db/schema/index.js";
import type {
  SdkConditionRow,
  SdkFlagSourceRow,
  SdkMeta,
  SdkRuleRow,
  SdkSegmentSourceRow,
  SdkTargetRow,
  SdkVariationRow,
} from "./sdk.types.js";

/** `inArray` with no ids is a query for nothing, not a query for everything. */
function isEmpty(ids: readonly string[]): boolean {
  return ids.length === 0;
}

export class SdkRepository {
  withSnapshot<T>(read: (tx: Transaction) => Promise<T>): Promise<T> {
    return db.transaction(read, {
      isolationLevel: "repeatable read",
      accessMode: "read only",
    });
  }
  async findMeta(
    projectId: string,
    environmentId: string,
    tx: Transaction,
  ): Promise<SdkMeta | null> {
    const rows = await tx
      .select({
        projectKey: project.key,
        projectName: project.name,
        environmentKey: environment.key,
        environmentName: environment.name,
      })
      .from(project)
      .innerJoin(environment, eq(environment.projectId, project.id))
      .where(
        and(
          eq(project.id, projectId),
          eq(environment.id, environmentId),
          isNull(project.archivedAt),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * Every flag of the project with its configuration in one environment.
   *
   * Archived flags are included: the engine serves the off variation for them,
   * and a flag that silently vanished from a client's snapshot would change what
   * that client serves.
   */
  async listFlagSources(
    projectId: string,
    environmentId: string,
    tx: Transaction,
    clientOnly = false,
  ): Promise<SdkFlagSourceRow[]> {
    return tx
      .select({
        id: flag.id,
        version: sql<number>`(select coalesce(max(${flagVersion.version}), 1) from ${flagVersion} where ${flagVersion.flagId} = ${flag.id} and ${flagVersion.environmentId} = ${environmentId})`,
        key: flag.key,
        type: flag.type,
        status: flag.status,
        enabled: flagEnvironmentConfig.enabled,
        offVariationKey: flagEnvironmentConfig.offVariationKey,
        defaultVariationKey: flagEnvironmentConfig.defaultVariationKey,
        rolloutPercentage: flagEnvironmentConfig.rolloutPercentage,
        bucketBy: flagEnvironmentConfig.bucketBy,
      })
      .from(flag)
      .innerJoin(
        flagEnvironmentConfig,
        and(
          eq(flagEnvironmentConfig.flagId, flag.id),
          eq(flagEnvironmentConfig.environmentId, environmentId),
        ),
      )
      .where(
        and(
          eq(flag.projectId, projectId),
          clientOnly ? eq(flag.clientVisible, true) : undefined,
        ),
      )
      .orderBy(asc(flag.key));
  }

  async listVariations(
    flagIds: readonly string[],
    tx: Transaction,
  ): Promise<SdkVariationRow[]> {
    if (isEmpty(flagIds)) return [];

    return tx
      .select({
        flagId: flagVariation.flagId,
        key: flagVariation.key,
        value: flagVariation.value,
      })
      .from(flagVariation)
      .where(inArray(flagVariation.flagId, [...flagIds]))
      .orderBy(asc(flagVariation.flagId), asc(flagVariation.key));
  }

  async listRules(
    flagIds: readonly string[],
    environmentId: string,
    tx: Transaction,
  ): Promise<SdkRuleRow[]> {
    if (isEmpty(flagIds)) return [];

    return tx
      .select({
        id: targetingRule.id,
        flagId: targetingRule.flagId,
        priority: targetingRule.priority,
        variationKey: targetingRule.variationKey,
        segmentKeys: targetingRule.segmentKeys,
        rolloutPercentage: targetingRule.rolloutPercentage,
        bucketBy: targetingRule.bucketBy,
      })
      .from(targetingRule)
      .where(
        and(
          inArray(targetingRule.flagId, [...flagIds]),
          eq(targetingRule.environmentId, environmentId),
        ),
      )
      .orderBy(
        asc(targetingRule.flagId),
        asc(targetingRule.priority),
        asc(targetingRule.id),
      );
  }

  async listRuleConditions(
    ruleIds: readonly string[],
    tx: Transaction,
  ): Promise<SdkConditionRow[]> {
    if (isEmpty(ruleIds)) return [];

    return tx
      .select({
        parentId: targetingCondition.ruleId,
        attribute: targetingCondition.attribute,
        operator: targetingCondition.operator,
        values: targetingCondition.values,
        priority: targetingCondition.priority,
      })
      .from(targetingCondition)
      .where(inArray(targetingCondition.ruleId, [...ruleIds]))
      .orderBy(
        asc(targetingCondition.ruleId),
        asc(targetingCondition.priority),
        asc(targetingCondition.id),
      );
  }

  async listTargets(
    flagIds: readonly string[],
    environmentId: string,
    tx: Transaction,
  ): Promise<SdkTargetRow[]> {
    if (isEmpty(flagIds)) return [];

    return tx
      .select({
        flagId: flagIndividualTarget.flagId,
        userId: flagIndividualTarget.userId,
        variationKey: flagIndividualTarget.variationKey,
      })
      .from(flagIndividualTarget)
      .where(
        and(
          inArray(flagIndividualTarget.flagId, [...flagIds]),
          eq(flagIndividualTarget.environmentId, environmentId),
        ),
      )
      .orderBy(
        asc(flagIndividualTarget.flagId),
        asc(flagIndividualTarget.userId),
      );
  }

  async listSegments(
    projectId: string,
    tx: Transaction,
  ): Promise<SdkSegmentSourceRow[]> {
    return tx
      .select({ id: segment.id, key: segment.key })
      .from(segment)
      .where(eq(segment.projectId, projectId))
      .orderBy(asc(segment.key));
  }

  async listSegmentConditions(
    segmentIds: readonly string[],
    tx: Transaction,
  ): Promise<SdkConditionRow[]> {
    if (isEmpty(segmentIds)) return [];

    return tx
      .select({
        parentId: segmentCondition.segmentId,
        attribute: segmentCondition.attribute,
        operator: segmentCondition.operator,
        values: segmentCondition.values,
        priority: segmentCondition.priority,
      })
      .from(segmentCondition)
      .where(inArray(segmentCondition.segmentId, [...segmentIds]))
      .orderBy(
        asc(segmentCondition.segmentId),
        asc(segmentCondition.priority),
        asc(segmentCondition.id),
      );
  }
}
