import type {
  FlagStatus,
  FlagType,
  SdkCondition,
  SdkConfig,
  SdkFlag,
  SdkRule,
  SdkSegment,
  SdkTarget,
  SdkVariation,
} from "@iwifunni/contracts";

import type {
  SdkConditionRow,
  SdkFlagSourceRow,
  SdkMeta,
  SdkRuleRow,
  SdkSegmentSourceRow,
  SdkTargetRow,
  SdkVariationRow,
} from "./sdk.types.js";

/**
 * The jsonb `values` column as the engine reads it.
 *
 * Normalised the same way the evaluation repository normalises it, so a row
 * written as a scalar or as null cannot change what a condition matches.
 */
export function toValues(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return value === null || value === undefined ? [] : [String(value)];
  }

  return value.map((entry) => String(entry));
}

export function toCondition(row: SdkConditionRow): SdkCondition {
  return {
    attribute: row.attribute,
    operator: row.operator,
    values: toValues(row.values),
  };
}

export function toVariation(row: SdkVariationRow): SdkVariation {
  return { key: row.key, value: row.value };
}

export function toRule(
  row: SdkRuleRow,
  conditions: SdkConditionRow[],
): SdkRule {
  return {
    id: row.id,
    priority: row.priority,
    variation: row.variationKey,
    segmentKeys: row.segmentKeys,
    rolloutPercentage: row.rolloutPercentage,
    bucketBy: row.bucketBy,
    conditions: conditions.map(toCondition),
  };
}

export function toTarget(row: SdkTargetRow): SdkTarget {
  return { userId: row.userId, variation: row.variationKey };
}

export function toFlag(
  source: SdkFlagSourceRow,
  variations: SdkVariationRow[],
  rules: SdkRule[],
  targets: SdkTarget[],
): SdkFlag {
  return {
    key: source.key,
    version: source.version,
    type: source.type as FlagType,
    status: source.status as FlagStatus,
    enabled: source.enabled,
    offVariation: source.offVariationKey,
    defaultVariation: source.defaultVariationKey,
    rolloutPercentage: source.rolloutPercentage,
    bucketBy: source.bucketBy,
    variations: variations.map(toVariation),
    rules,
    targets,
  };
}

export function toSegment(
  source: SdkSegmentSourceRow,
  conditions: SdkConditionRow[],
): SdkSegment {
  return { key: source.key, conditions: conditions.map(toCondition) };
}

/**
 * The snapshot, with `version` already computed from everything else in it.
 *
 * The key order here is the order the version is hashed over, so it is part of
 * the wire contract: reordering it changes every version.
 */
export function toConfig(
  meta: SdkMeta,
  version: string,
  flags: SdkFlag[],
  segments: SdkSegment[],
): SdkConfig {
  return {
    version,
    project: { key: meta.projectKey, name: meta.projectName },
    environment: { key: meta.environmentKey, name: meta.environmentName },
    flags,
    segments,
  };
}
