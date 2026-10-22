import {
  flagVariationValueSchema,
  scheduledFlagChangeSchema,
  flagRollbackPolicySchema,
  type FlagRollbackPolicy,
  type ScheduledFlagChange,
  type FlagDetail,
  type FlagEnvironmentConfig,
  type FlagIndividualTarget,
  type FlagStatus,
  type FlagSummary,
  type FlagType,
  type FlagVariation,
  type FlagVariationValue,
  type FlagVersion,
  type TargetingAttributeType,
  type TargetingCondition,
  type TargetingOperator,
  type TargetingRule,
  type WorkspaceFlagSummary,
} from "@iwifunni/contracts";

import type {
  EnvironmentRef,
  FlagEnvironmentConfigRow,
  FlagListRow,
  FlagRow,
  FlagVersionSummary,
  IndividualTargetRow,
  RuleWithConditions,
  VariationRow,
} from "./flags.types.js";
import type { ScheduledFlagChangeRow } from "./flags.types.js";
import type { FlagRollbackRow } from "./flags.types.js";

export function toFlagRollback(row: FlagRollbackRow): FlagRollbackPolicy {
  return flagRollbackPolicySchema.parse({
    ...row,
    armedAt: row.armedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

export function toScheduledFlagChange(
  row: ScheduledFlagChangeRow,
): ScheduledFlagChange {
  return scheduledFlagChangeSchema.parse({
    ...row,
    executeAt: row.executeAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
  });
}

function toVariationValue(value: unknown): FlagVariationValue {
  const parsed = flagVariationValueSchema.safeParse(value);

  // `jsonb` can only hold JSON, so this never fails for a stored row; it is
  // checked rather than asserted so a value written before the contract widened
  // still cannot reach the client unvalidated.
  return parsed.success ? parsed.data : null;
}

function toConditionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return value === null ? [] : [String(value)];

  return value.map((entry) => String(entry));
}

/** jsonb comes back as `unknown`; the wire contract only allows scalars. */
export function toVariation(row: VariationRow): FlagVariation {
  return {
    key: row.key,
    name: row.name,
    value: toVariationValue(row.value),
    description: row.description,
  };
}

export function toVariations(rows: VariationRow[]): FlagVariation[] {
  return rows.map(toVariation);
}

export function toTargetingRule(entry: RuleWithConditions): TargetingRule {
  return {
    id: entry.rule.id,
    description: entry.rule.description,
    conditions: entry.conditions.map(
      (condition): TargetingCondition => ({
        id: condition.id,
        attribute: condition.attribute,
        attributeType: condition.attributeType as TargetingAttributeType,
        operator: condition.operator as TargetingOperator,
        values: toConditionValues(condition.values),
      }),
    ),
    variation: entry.rule.variationKey,
    segmentKeys: entry.rule.segmentKeys,
    rollout:
      entry.rule.rolloutPercentage === null
        ? null
        : {
            percentage: entry.rule.rolloutPercentage,
            bucketBy: entry.rule.bucketBy ?? "userId",
          },
  };
}

export function toTargetingRules(
  entries: RuleWithConditions[],
): TargetingRule[] {
  return entries.map(toTargetingRule);
}

export function toIndividualTargets(
  targets: Array<{ userId: string; variationKey: string }>,
): FlagIndividualTarget[] {
  return targets.map((target) => ({
    userId: target.userId,
    variationKey: target.variationKey,
  }));
}

/** The variation a publish served, when the snapshot recorded one. */
function serveFromSnapshot(snapshot: unknown): string | null {
  if (!snapshot || typeof snapshot !== "object" || !("serve" in snapshot)) {
    return null;
  }

  const serve = (snapshot as { serve: unknown }).serve;

  return typeof serve === "string" ? serve : null;
}

export function toFlagVersion(
  row: FlagVersionSummary,
  environmentKey: string,
): FlagVersion {
  return {
    version: row.version,
    environmentKey,
    description: row.description,
    author: row.author,
    serve: serveFromSnapshot(row.snapshot),
    createdAt: row.createdAt.toISOString(),
  };
}

function toIdentity(row: FlagRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    name: row.name,
    description: row.description,
    type: row.type as FlagType,
    tags: row.tags,
    owner: row.owner,
    status: row.status as FlagStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * A list row carries how the flag stands in every environment of its project, so
 * the screen needs no request per environment.
 */
export function toFlagSummary(row: FlagListRow): FlagSummary {
  return { ...toIdentity(row), environments: row.environments };
}

/** The workspace-wide list spans projects, so each row carries its project key. */
export function toWorkspaceFlagSummary(
  row: FlagListRow & { projectKey: string },
): WorkspaceFlagSummary {
  return { ...toFlagSummary(row), projectKey: row.projectKey };
}

/** One flag on its own: its identity, its environments and the values it can serve. */
export function toFlagDetail(
  row: FlagListRow,
  variations: VariationRow[],
): FlagDetail {
  return { ...toFlagSummary(row), variations: toVariations(variations) };
}

/** What one flag does in one environment. */
export function toFlagEnvironmentConfig(
  environment: EnvironmentRef,
  config: FlagEnvironmentConfigRow,
  parts: {
    rules: RuleWithConditions[];
    targets: IndividualTargetRow[];
  },
): FlagEnvironmentConfig {
  return {
    environmentKey: environment.key,
    environmentName: environment.name,
    enabled: config.enabled,
    offVariation: config.offVariationKey,
    defaultVariation: config.defaultVariationKey,
    rolloutPercentage: config.rolloutPercentage,
    bucketBy: config.bucketBy,
    rules: toTargetingRules(parts.rules),
    individualTargets: toIndividualTargets(parts.targets),
  };
}
