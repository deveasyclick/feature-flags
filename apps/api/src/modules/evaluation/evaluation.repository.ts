import type {
  EvaluationCondition,
  EvaluationConfig,
  EvaluationRule,
  EvaluationSegment,
  EvaluationTarget,
} from "@iwifunni/engine";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
  environment,
  flag,
  flagEnvironmentConfig,
  flagIndividualTarget,
  project,
  segment,
  segmentCondition,
  targetingCondition,
  targetingRule,
} from "../../db/schema/index.js";

export interface EvaluationTargetData {
  flagKey: string;
  flagStatus: string;
  config: EvaluationConfig;
  rules: EvaluationRule[];
  targets: EvaluationTarget[];
  segments: EvaluationSegment[];
}

export interface EvaluationLookup {
  projectKey?: string;
  flagKey: string;
  environmentKey: string;
}

function toValues(value: unknown): string[] {
  if (!Array.isArray(value)) return value === null ? [] : [String(value)];

  return value.map((entry) => String(entry));
}

function toCondition(row: {
  attribute: string;
  attributeType: string;
  operator: string;
  values: unknown;
}): EvaluationCondition {
  return {
    attribute: row.attribute,
    attributeType: row.attributeType,
    operator: row.operator,
    values: toValues(row.values),
  };
}

export class EvaluationRepository {
  /**
   * Resolves the flag and environment inside the caller's workspace. The same
   * flag and environment keys can exist in two projects, so the lowest project
   * key wins unless the caller named one.
   */
  async findTarget(
    organizationId: string,
    lookup: EvaluationLookup,
  ): Promise<EvaluationTargetData | null> {
    const conditions = [
      eq(project.organizationId, organizationId),
      eq(flag.key, lookup.flagKey),
      eq(environment.key, lookup.environmentKey),
    ];

    if (lookup.projectKey) {
      conditions.push(eq(project.key, lookup.projectKey));
    }

    const rows = await db
      .select({
        projectId: project.id,
        flagId: flag.id,
        flagKey: flag.key,
        flagStatus: flag.status,
        environmentId: environment.id,
        enabled: flagEnvironmentConfig.enabled,
        offVariationKey: flagEnvironmentConfig.offVariationKey,
        defaultVariationKey: flagEnvironmentConfig.defaultVariationKey,
        rolloutPercentage: flagEnvironmentConfig.rolloutPercentage,
        bucketBy: flagEnvironmentConfig.bucketBy,
      })
      .from(flag)
      .innerJoin(project, eq(project.id, flag.projectId))
      .innerJoin(environment, eq(environment.projectId, project.id))
      .innerJoin(
        flagEnvironmentConfig,
        and(
          eq(flagEnvironmentConfig.flagId, flag.id),
          eq(flagEnvironmentConfig.environmentId, environment.id),
        ),
      )
      .where(and(...conditions))
      .orderBy(asc(project.key))
      .limit(1);

    const row = rows[0];

    if (!row) return null;

    const rules = await this.listRules(row.flagId, row.environmentId);
    const targets = await db
      .select({
        userId: flagIndividualTarget.userId,
        variationKey: flagIndividualTarget.variationKey,
      })
      .from(flagIndividualTarget)
      .where(
        and(
          eq(flagIndividualTarget.flagId, row.flagId),
          eq(flagIndividualTarget.environmentId, row.environmentId),
        ),
      );

    const segmentKeys = [...new Set(rules.flatMap((rule) => rule.segmentKeys))];
    const segments = await this.listSegments(row.projectId, segmentKeys);

    return {
      flagKey: row.flagKey,
      flagStatus: row.flagStatus,
      // Every flag has a configuration in every environment of its project, so
      // a resolved flag always has one to decide from.
      config: {
        enabled: row.enabled,
        offVariation: row.offVariationKey,
        defaultVariation: row.defaultVariationKey,
        rolloutPercentage: row.rolloutPercentage,
        bucketBy: row.bucketBy,
      },
      rules,
      targets,
      segments,
    };
  }

  private async listRules(
    flagId: string,
    environmentId: string,
  ): Promise<EvaluationRule[]> {
    const rules = await db
      .select({
        id: targetingRule.id,
        variationKey: targetingRule.variationKey,
        segmentKeys: targetingRule.segmentKeys,
        rolloutPercentage: targetingRule.rolloutPercentage,
        bucketBy: targetingRule.bucketBy,
      })
      .from(targetingRule)
      .where(
        and(
          eq(targetingRule.flagId, flagId),
          eq(targetingRule.environmentId, environmentId),
        ),
      )
      .orderBy(asc(targetingRule.priority));

    if (rules.length === 0) return [];

    const conditions = await db
      .select({
        ruleId: targetingCondition.ruleId,
        attribute: targetingCondition.attribute,
        attributeType: targetingCondition.attributeType,
        operator: targetingCondition.operator,
        values: targetingCondition.values,
      })
      .from(targetingCondition)
      .where(
        inArray(
          targetingCondition.ruleId,
          rules.map((rule) => rule.id),
        ),
      )
      .orderBy(asc(targetingCondition.priority));

    return rules.map((rule) => ({
      id: rule.id,
      variation: rule.variationKey,
      segmentKeys: rule.segmentKeys,
      rolloutPercentage: rule.rolloutPercentage,
      bucketBy: rule.bucketBy,
      conditions: conditions
        .filter((condition) => condition.ruleId === rule.id)
        .map(toCondition),
    }));
  }

  /**
   * Archived segments still resolve: a rule references them by key, and a
   * hidden segment must not silently change what a flag serves.
   */
  private async listSegments(
    projectId: string,
    keys: string[],
  ): Promise<EvaluationSegment[]> {
    if (keys.length === 0) return [];

    const segments = await db
      .select({ id: segment.id, key: segment.key })
      .from(segment)
      .where(and(eq(segment.projectId, projectId), inArray(segment.key, keys)));

    if (segments.length === 0) return [];

    const conditions = await db
      .select({
        segmentId: segmentCondition.segmentId,
        attribute: segmentCondition.attribute,
        attributeType: segmentCondition.attributeType,
        operator: segmentCondition.operator,
        values: segmentCondition.values,
      })
      .from(segmentCondition)
      .where(
        inArray(
          segmentCondition.segmentId,
          segments.map((entry) => entry.id),
        ),
      )
      .orderBy(asc(segmentCondition.priority));

    return segments.map((entry) => ({
      key: entry.key,
      conditions: conditions
        .filter((condition) => condition.segmentId === entry.id)
        .map(toCondition),
    }));
  }
}
