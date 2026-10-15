import type { SdkConfig } from "@iwifunni/contracts";

import { evaluate } from "#evaluate";
import {
  OFF_VARIATION,
  type EvaluationCondition,
  type EvaluationInput,
  type EvaluationOutcome,
  type EvaluationSubject,
} from "#types";

/**
 * The context an SDK evaluates for: the subject id plus whatever attributes
 * targeting reads.
 */
export interface SdkContext {
  userId: string;
  attributes?: Record<string, string | number | boolean>;
}

/** The engine's flat subject, built from an SDK context. */
export function toSubject(context: SdkContext): EvaluationSubject {
  return { ...(context.attributes ?? {}), id: context.userId };
}

function toConditions(
  conditions: ReadonlyArray<{
    attribute: string;
    operator: string;
    values: string[];
  }>,
): EvaluationCondition[] {
  return conditions.map((condition) => ({
    attribute: condition.attribute,
    operator: condition.operator,
    values: condition.values,
  }));
}

/**
 * The snapshot rows one flag's decision needs, in the engine's input shape.
 *
 * Returns `null` when the snapshot does not carry the flag, which the caller
 * reports as `flag_not_found` rather than inventing a decision.
 */
export function toEvaluationInput(
  config: SdkConfig,
  flagKey: string,
  subject: EvaluationSubject,
): EvaluationInput | null {
  const flag = config.flags.find((entry) => entry.key === flagKey);

  if (!flag) return null;

  return {
    flag: { key: flag.key, status: flag.status },
    config: {
      enabled: flag.enabled,
      offVariation: flag.offVariation,
      defaultVariation: flag.defaultVariation,
      rolloutPercentage: flag.rolloutPercentage,
      bucketBy: flag.bucketBy,
    },
    rules: flag.rules.map((rule) => ({
      id: rule.id,
      conditions: toConditions(rule.conditions),
      variation: rule.variation,
      segmentKeys: rule.segmentKeys,
      rolloutPercentage: rule.rolloutPercentage,
      bucketBy: rule.bucketBy,
    })),
    targets: flag.targets.map((target) => ({
      userId: target.userId,
      variationKey: target.variation,
    })),
    segments: config.segments.map((segment) => ({
      key: segment.key,
      conditions: toConditions(segment.conditions),
    })),
    subject,
  };
}

/** The outcome a snapshot that does not carry the flag produces. */
export function notFoundOutcome(flagKey: string): EvaluationOutcome {
  return {
    flag: flagKey,
    enabled: false,
    variation: OFF_VARIATION,
    reason: "flag_not_found",
    matchedRuleId: null,
  };
}

/** Decide one flag from a snapshot. A flag the snapshot lacks is `flag_not_found`. */
export function evaluateSnapshot(
  config: SdkConfig,
  flagKey: string,
  subject: EvaluationSubject,
): EvaluationOutcome {
  const input = toEvaluationInput(config, flagKey, subject);

  if (!input) return notFoundOutcome(flagKey);

  return evaluate(input);
}

/**
 * The JSON value the served variation holds, for the typed getters.
 *
 * `undefined` when the flag or the variation is absent, or when the variation
 * carries no value.
 */
export function servedValue(
  config: SdkConfig,
  flagKey: string,
  variationKey: string,
): unknown {
  const flag = config.flags.find((entry) => entry.key === flagKey);
  const variation = flag?.variations.find(
    (entry) => entry.key === variationKey,
  );

  return variation?.value;
}
