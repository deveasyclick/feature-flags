import type { EvaluationReason } from "@dariise/contracts";

import { bucketFor } from "#bucket";
import type {
  EvaluationCondition,
  EvaluationInput,
  EvaluationOutcome,
  EvaluationSegment,
  EvaluationSubject,
} from "#types";

function attributeOf(subject: EvaluationSubject, attribute: string): unknown {
  return subject[attribute];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return value;

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);

    return Number.isNaN(parsed) ? null : parsed;
  }

  return null;
}

function includesValue(values: string[], attribute: unknown): boolean {
  return values.some((value) => String(value) === String(attribute));
}

/** Whether one condition holds for one subject. */
export function satisfies(
  condition: EvaluationCondition,
  subject: EvaluationSubject,
): boolean {
  const attribute = attributeOf(subject, condition.attribute);

  switch (condition.operator) {
    case "equals":
      return (
        attribute !== undefined && String(attribute) === condition.values[0]
      );

    case "not_equals":
      return (
        attribute === undefined || String(attribute) !== condition.values[0]
      );

    case "contains":
      return (
        attribute !== undefined &&
        condition.values.some((value) => String(attribute).includes(value))
      );

    case "not_contains":
      return (
        attribute === undefined ||
        !condition.values.some((value) => String(attribute).includes(value))
      );

    case "in":
      return (
        attribute !== undefined && includesValue(condition.values, attribute)
      );

    case "not_in":
      return (
        attribute === undefined || !includesValue(condition.values, attribute)
      );

    case "greater_than":
    case "greater_than_or_equal":
    case "less_than":
    case "less_than_or_equal": {
      const left = toNumber(attribute);
      const right = toNumber(condition.values[0]);

      if (left === null || right === null) return false;

      if (condition.operator === "greater_than") return left > right;
      if (condition.operator === "greater_than_or_equal") return left >= right;
      if (condition.operator === "less_than") return left < right;

      return left <= right;
    }

    case "matches_regex": {
      if (attribute === undefined) return false;

      try {
        return new RegExp(condition.values[0] ?? "").test(String(attribute));
      } catch {
        // An invalid pattern matches nothing rather than failing the request.
        return false;
      }
    }

    default:
      return false;
  }
}

function allConditionsMatch(
  conditions: EvaluationCondition[],
  subject: EvaluationSubject,
): boolean {
  return conditions.every((condition) => satisfies(condition, subject));
}

function segmentMatches(
  segment: EvaluationSegment,
  subject: EvaluationSubject,
): boolean {
  return allConditionsMatch(segment.conditions, subject);
}

function bucketValue(subject: EvaluationSubject, bucketBy: string): string {
  const attribute = subject[bucketBy];

  return attribute === undefined ? subject.id : String(attribute);
}

/**
 * A pure function over already-loaded rows: no I/O, no clock, no randomness, so
 * the same input always produces the same decision.
 */
export function evaluate(input: EvaluationInput): EvaluationOutcome {
  const { config, flag, subject } = input;

  const serve = (
    variation: string,
    reason: EvaluationReason,
    matchedRuleId: string | null = null,
  ): EvaluationOutcome => ({
    flag: flag.key,
    enabled: variation !== config.offVariation,
    variation,
    reason,
    matchedRuleId,
  });

  if (flag.status === "archived") {
    return serve(config.offVariation, "flag_archived");
  }

  if (!config.enabled) {
    return serve(config.offVariation, "flag_disabled");
  }

  const target = input.targets.find((entry) => entry.userId === subject.id);

  if (target) {
    return serve(target.variationKey, "targeting_rule");
  }

  for (const rule of input.rules) {
    if (!allConditionsMatch(rule.conditions, subject)) continue;

    const segmentsMatch = rule.segmentKeys.every((key) => {
      const segment = input.segments.find((entry) => entry.key === key);

      return segment ? segmentMatches(segment, subject) : false;
    });

    if (!segmentsMatch) continue;

    if (rule.rolloutPercentage !== null) {
      const bucketBy = rule.bucketBy ?? config.bucketBy;

      if (
        bucketFor(flag.key, bucketValue(subject, bucketBy)) >=
        rule.rolloutPercentage
      ) {
        continue;
      }
    }

    return serve(
      rule.variation,
      rule.segmentKeys.length > 0 ? "segment" : "targeting_rule",
      rule.id,
    );
  }

  const percentage = config.rolloutPercentage;

  // The endpoints are thresholds like any other: 0 sends everybody to the off
  // variation and 100 to the default one, so only 100 can skip the bucket.
  if (percentage < 100) {
    const bucket = bucketFor(flag.key, bucketValue(subject, config.bucketBy));

    return serve(
      bucket < percentage ? config.defaultVariation : config.offVariation,
      "percentage_rollout",
    );
  }

  return serve(config.defaultVariation, "default_variation");
}
