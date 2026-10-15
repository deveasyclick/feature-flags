import type { SdkConfig, SdkFlag, SdkSegment } from "@iwifunni/contracts";

import { bucketFor } from "#bucket";
import {
  evaluateSnapshot,
  servedValue,
  toSubject,
  type SdkContext,
} from "#snapshot";
import type { EvaluationOutcome } from "#types";

/**
 * The conformance corpus every SDK is held to.
 *
 * The engine here is the reference implementation; the other languages
 * re-implement it, so they are checked against this file rather than against a
 * reading of the docs. It is generated from the reference engine and committed,
 * and a test asserts the committed file still matches a fresh generation — which
 * is what makes a change to the algorithm fail every SDK's tests instead of
 * quietly drifting.
 */
export interface ConformanceCase {
  name: string;
  config: SdkConfig;
  context: SdkContext;
  /** What the decision must be. */
  expect: EvaluationOutcome;
  /** The value the served variation carries, when the case has one. */
  value?: unknown;
}

export interface Conformance {
  formatVersion: number;
  bucketing: Array<{ flagKey: string; value: string; bucket: number }>;
  snapshot: ConformanceCase[];
}

function flag(overrides: Partial<SdkFlag> & { key: string }): SdkFlag {
  return {
    type: "boolean",
    status: "active",
    enabled: true,
    offVariation: "off",
    defaultVariation: "on",
    // Fully on unless a case narrows it: 0 is a threshold meaning "serve
    // nobody", so it is never the right default for a case about anything else.
    rolloutPercentage: 100,
    bucketBy: "userId",
    variations: [
      { key: "on", value: true },
      { key: "off", value: false },
    ],
    rules: [],
    targets: [],
    ...overrides,
  };
}

function segment(key: string, attribute: string, values: string[]): SdkSegment {
  return {
    key,
    conditions: [{ attribute, operator: "equals", values }],
  };
}

function config(
  flags: SdkFlag[],
  segments: SdkSegment[] = [],
  environment = "production",
): SdkConfig {
  return {
    version: "conformance",
    project: { key: "checkout", name: "Checkout" },
    environment: { key: environment, name: environment },
    flags,
    segments,
  };
}

const BUCKET_VECTORS: Array<{ flagKey: string; value: string }> = [
  { flagKey: "checkout-v2", value: "user-1" },
  { flagKey: "checkout-v2", value: "user-2" },
  { flagKey: "checkout-v2", value: "user-42" },
  { flagKey: "checkout-v2", value: "acme" },
  { flagKey: "checkout-v2", value: "" },
  { flagKey: "flag-a", value: "user-1" },
  { flagKey: "flag-b", value: "user-1" },
  { flagKey: "max-items", value: "123" },
  { flagKey: "max-items", value: "1234567890" },
  { flagKey: "emoji-🚀", value: "user-1" },
];

const CASES: ConformanceCase[] = [];

function addCase(
  name: string,
  configForCase: SdkConfig,
  context: SdkContext,
  flagKey: string,
): void {
  const subject = toSubject(context);
  const outcome = evaluateSnapshot(configForCase, flagKey, subject);

  const entry: ConformanceCase = {
    name,
    config: configForCase,
    context,
    expect: outcome,
  };

  const value = servedValue(configForCase, flagKey, outcome.variation);

  if (value !== undefined) entry.value = value;

  CASES.push(entry);
}

addCase(
  "an active flag with no targeting serves its default variation",
  config([flag({ key: "checkout-v2" })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a disabled flag serves the off variation",
  config([flag({ key: "checkout-v2", enabled: false })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "an archived flag serves the off variation",
  config([flag({ key: "checkout-v2", status: "archived" })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a flag the snapshot does not carry is not found",
  config([flag({ key: "checkout-v2" })]),
  { userId: "user-1" },
  "missing-flag",
);

addCase(
  "an individual target wins over a rule",
  config([
    flag({
      key: "checkout-v2",
      targets: [{ userId: "user-1", variation: "off" }],
      rules: [
        {
          id: "rule-1",
          priority: 0,
          variation: "on",
          segmentKeys: [],
          rolloutPercentage: null,
          bucketBy: null,
          conditions: [],
        },
      ],
    }),
  ]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a rule matches on an attribute",
  config([
    flag({
      key: "checkout-v2",
      rules: [
        {
          id: "rule-1",
          priority: 0,
          variation: "off",
          segmentKeys: [],
          rolloutPercentage: null,
          bucketBy: null,
          conditions: [
            { attribute: "plan", operator: "equals", values: ["beta"] },
          ],
        },
      ],
    }),
  ]),
  { userId: "user-1", attributes: { plan: "beta" } },
  "checkout-v2",
);

addCase(
  "a rule whose segment does not match is skipped",
  config(
    [
      flag({
        key: "checkout-v2",
        rules: [
          {
            id: "rule-1",
            priority: 0,
            variation: "off",
            segmentKeys: ["beta-users"],
            rolloutPercentage: null,
            bucketBy: null,
            conditions: [],
          },
        ],
      }),
    ],
    [segment("beta-users", "plan", ["beta"])],
  ),
  { userId: "user-1", attributes: { plan: "free" } },
  "checkout-v2",
);

addCase(
  "a rule whose segment matches reports the segment reason",
  config(
    [
      flag({
        key: "checkout-v2",
        rules: [
          {
            id: "rule-1",
            priority: 0,
            variation: "off",
            segmentKeys: ["beta-users"],
            rolloutPercentage: null,
            bucketBy: null,
            conditions: [],
          },
        ],
      }),
    ],
    [segment("beta-users", "plan", ["beta"])],
  ),
  { userId: "user-1", attributes: { plan: "beta" } },
  "checkout-v2",
);

addCase(
  "a full rollout serves the default variation",
  config([flag({ key: "checkout-v2", rolloutPercentage: 100 })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a partial rollout buckets the subject",
  config([flag({ key: "checkout-v2", rolloutPercentage: 50 })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a zero rollout serves the off variation",
  config([flag({ key: "checkout-v2", rolloutPercentage: 0 })]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a string flag serves its variation value",
  config([
    flag({
      key: "checkout-version",
      type: "string",
      variations: [
        { key: "on", value: "v2" },
        { key: "off", value: "legacy" },
      ],
    }),
  ]),
  { userId: "user-1" },
  "checkout-version",
);

/** The bucket each subject below reaches, so a rule boundary can sit on one. */
const SUBJECT_BUCKET = bucketFor("checkout-v2", "user-1");
const ACCOUNT_BUCKET = bucketFor("checkout-v2", "acme");

if (SUBJECT_BUCKET === ACCOUNT_BUCKET) {
  throw new Error("The two conformance subjects no longer bucket apart.");
}

/**
 * A rollout between the two buckets, so a rule that reads its own `bucketBy`
 * decides this case differently from one that ignores it.
 */
const RULE_BUCKET_ROLLOUT = Math.min(SUBJECT_BUCKET, ACCOUNT_BUCKET) + 1;

/** A one-rule flag whose rule carries the rollout, so the rule gate is the case. */
function rolloutRule(
  rolloutPercentage: number,
  bucketBy: string | null = null,
): SdkFlag {
  return flag({
    key: "checkout-v2",
    rules: [
      {
        id: "rule-1",
        priority: 0,
        variation: "off",
        segmentKeys: [],
        rolloutPercentage,
        bucketBy,
        conditions: [],
      },
    ],
  });
}

/** Every operator the engine implements, against a subject that satisfies it or not. */
const OPERATOR_CASES: Array<
  [string, string, string[], string | number | undefined]
> = [
  ["an equals condition matches its value", "equals", ["beta"], "beta"],
  ["an equals condition ignores another value", "equals", ["beta"], "free"],
  [
    "an equals condition on a missing attribute does not match",
    "equals",
    ["beta"],
    undefined,
  ],
  [
    "a not_equals condition matches another value",
    "not_equals",
    ["beta"],
    "free",
  ],
  [
    "a not_equals condition rejects its own value",
    "not_equals",
    ["beta"],
    "beta",
  ],
  [
    "a not_equals condition matches a missing attribute",
    "not_equals",
    ["beta"],
    undefined,
  ],
  [
    "a contains condition matches a substring",
    "contains",
    ["beta"],
    "beta-plan",
  ],
  [
    "a contains condition ignores another substring",
    "contains",
    ["beta"],
    "free-plan",
  ],
  [
    "a not_contains condition matches another substring",
    "not_contains",
    ["beta"],
    "free-plan",
  ],
  [
    "a not_contains condition rejects its substring",
    "not_contains",
    ["beta"],
    "beta-plan",
  ],
  [
    "an in condition matches one of its values",
    "in",
    ["beta", "gamma"],
    "gamma",
  ],
  [
    "an in condition ignores a value outside the list",
    "in",
    ["beta", "gamma"],
    "free",
  ],
  [
    "a not_in condition matches a value outside the list",
    "not_in",
    ["beta", "gamma"],
    "free",
  ],
  [
    "a not_in condition rejects one of its values",
    "not_in",
    ["beta", "gamma"],
    "beta",
  ],
  [
    "a greater_than condition matches a larger number",
    "greater_than",
    ["5"],
    "10",
  ],
  [
    "a greater_than condition ignores an equal number",
    "greater_than",
    ["5"],
    "5",
  ],
  [
    "a greater_than condition matches a numeric attribute",
    "greater_than",
    ["5"],
    10,
  ],
  [
    "a greater_than condition ignores a non-numeric attribute",
    "greater_than",
    ["5"],
    "beta",
  ],
  [
    "a greater_than_or_equal condition matches its bound",
    "greater_than_or_equal",
    ["5"],
    "5",
  ],
  [
    "a greater_than_or_equal condition ignores a smaller number",
    "greater_than_or_equal",
    ["5"],
    "4",
  ],
  ["a less_than condition matches a smaller number", "less_than", ["5"], "4"],
  ["a less_than condition ignores an equal number", "less_than", ["5"], "5"],
  [
    "a less_than_or_equal condition matches its bound",
    "less_than_or_equal",
    ["5"],
    "5",
  ],
  [
    "a less_than_or_equal condition ignores a larger number",
    "less_than_or_equal",
    ["5"],
    "6",
  ],
  [
    "a matches_regex condition matches a pattern",
    "matches_regex",
    ["^user-[0-9]+$"],
    "user-42",
  ],
  [
    "a matches_regex condition ignores another string",
    "matches_regex",
    ["^user-[0-9]+$"],
    "admin-1",
  ],
  [
    "a matches_regex condition with a broken pattern matches nothing",
    "matches_regex",
    ["("],
    "user-42",
  ],
  [
    "a matches_regex condition on a missing attribute does not match",
    "matches_regex",
    ["^user"],
    undefined,
  ],
  ["an unknown operator matches nothing", "unknown_operator", ["beta"], "beta"],
];

for (const [name, operator, values, attribute] of OPERATOR_CASES) {
  addCase(
    name,
    config([
      flag({
        key: "checkout-v2",
        rules: [
          {
            id: "rule-1",
            priority: 0,
            variation: "off",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
            conditions: [{ attribute: "plan", operator, values }],
          },
        ],
      }),
    ]),
    {
      userId: "user-1",
      attributes: attribute === undefined ? {} : { plan: attribute },
    },
    "checkout-v2",
  );
}

addCase(
  "a rule whose rollout sits on the subject bucket does not apply",
  config([rolloutRule(SUBJECT_BUCKET)]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a rule one point above the subject bucket applies",
  config([rolloutRule(SUBJECT_BUCKET + 1)]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a rule at 100% always applies",
  config([rolloutRule(100)]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a rule at 0% never applies",
  config([rolloutRule(0)]),
  { userId: "user-1" },
  "checkout-v2",
);

addCase(
  "a rule buckets by its own attribute",
  config([rolloutRule(RULE_BUCKET_ROLLOUT, "accountId")]),
  { userId: "user-1", attributes: { accountId: "acme" } },
  "checkout-v2",
);

addCase(
  "a rule without its own bucket attribute falls back to the subject id",
  config([rolloutRule(SUBJECT_BUCKET + 1, "accountId")]),
  { userId: "user-1" },
  "checkout-v2",
);

export function buildConformance(): Conformance {
  return {
    formatVersion: 1,
    bucketing: BUCKET_VECTORS.map((vector) => ({
      ...vector,
      bucket: bucketFor(vector.flagKey, vector.value),
    })),
    snapshot: CASES,
  };
}
