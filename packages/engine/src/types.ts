import type { EvaluationReason } from "@iwifunni/contracts";

/** The flag's identity as the engine needs it: a key and a lifecycle status. */
export interface EvaluationFlag {
  key: string;
  status: string;
}

/** What one flag does in one environment, as the engine reads it. */
export interface EvaluationConfig {
  enabled: boolean;
  offVariation: string;
  defaultVariation: string;
  rolloutPercentage: number;
  bucketBy: string;
}

/**
 * One condition of a rule or a segment.
 *
 * `attributeType` is carried for readers of the row but never consulted:
 * `satisfies` decides on the operator alone.
 */
export interface EvaluationCondition {
  attribute: string;
  operator: string;
  values: string[];
  attributeType?: string;
}

export interface EvaluationRule {
  id: string;
  conditions: EvaluationCondition[];
  variation: string;
  segmentKeys: string[];
  rolloutPercentage: number | null;
  bucketBy: string | null;
}

export interface EvaluationSegment {
  key: string;
  conditions: EvaluationCondition[];
}

export interface EvaluationTarget {
  userId: string;
  variationKey: string;
}

/** The subject a decision is made for: an id plus the attributes targeting reads. */
export interface EvaluationSubject {
  id: string;
  [attribute: string]: string | number | boolean | undefined;
}

export interface EvaluationInput {
  flag: EvaluationFlag;
  config: EvaluationConfig;
  rules: EvaluationRule[];
  targets: EvaluationTarget[];
  segments: EvaluationSegment[];
  subject: EvaluationSubject;
}

export interface EvaluationOutcome {
  flag: string;
  enabled: boolean;
  variation: string;
  reason: EvaluationReason;
  matchedRuleId: string | null;
}

/** The variation served when a flag is off, archived or missing. */
export const OFF_VARIATION = "off";

/**
 * The bucketing algorithm's version.
 *
 * It is part of the hash input, so changing the input or the version reshuffles
 * everybody already bucketed; the constant carries the version rather than
 * being edited in place.
 */
export const EVALUATION_HASH_VERSION = "v1";
