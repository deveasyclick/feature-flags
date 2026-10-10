import type {
  FlagStatus,
  SegmentDetail,
  SegmentFlag,
  SegmentSummary,
  TargetingAttributeType,
  TargetingCondition,
  TargetingOperator,
} from "@dariise/contracts";

import type {
  SegmentConditionRow,
  SegmentFlagRow,
  SegmentRow,
} from "./segments.types.js";

function toConditionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return value === null ? [] : [String(value)];

  return value.map((entry) => String(entry));
}

export function toTargetingCondition(
  row: SegmentConditionRow,
): TargetingCondition {
  return {
    id: row.id,
    attribute: row.attribute,
    attributeType: row.attributeType as TargetingAttributeType,
    operator: row.operator as TargetingOperator,
    values: toConditionValues(row.values),
  };
}

export function toSegmentSummary(
  row: SegmentRow,
  conditionCount: number,
): SegmentSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    conditionCount,
  };
}

export function toSegmentDetail(
  row: SegmentRow,
  conditions: SegmentConditionRow[],
): SegmentDetail {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    name: row.name,
    description: row.description,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    conditions: conditions.map(toTargetingCondition),
  };
}

/**
 * One row per flag and environment: several rules in the same environment can
 * reference the same segment, and the screen lists it once.
 */
export function toSegmentFlags(rows: SegmentFlagRow[]): SegmentFlag[] {
  const byFlagEnvironment = new Map<string, SegmentFlag>();

  for (const row of rows) {
    const id = `${row.key}::${row.environmentKey}`;
    // A flag that is off, or at 0%, serves nobody, so it is not a rollout
    // under way. The same boundary applies at rule level: a rule at 0% is
    // applied to nobody, so the flag it hangs off is not rolling out.
    const rolloutPercentage = row.rolloutPercentage ?? 0;
    const atFlagLevel = rolloutPercentage > 0 && rolloutPercentage < 100;
    const atRuleLevel =
      row.ruleRolloutPercentage !== null &&
      row.ruleRolloutPercentage > 0 &&
      row.ruleRolloutPercentage < 100;

    byFlagEnvironment.set(id, {
      key: row.key,
      environmentKey: row.environmentKey,
      status: row.status as FlagStatus,
      isRollout:
        (byFlagEnvironment.get(id)?.isRollout ?? false) ||
        atFlagLevel ||
        atRuleLevel,
    });
  }

  return [...byFlagEnvironment.values()];
}
