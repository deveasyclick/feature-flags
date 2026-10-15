import { describe, expect, it } from "vitest";

import { bucketFor } from "./bucket.js";
import { evaluate } from "./evaluate.js";
import { EVALUATION_HASH_VERSION, type EvaluationInput } from "./types.js";

function input(overrides: Partial<EvaluationInput> = {}): EvaluationInput {
  return {
    flag: { key: "checkout-v2", status: "active" },
    config: {
      enabled: true,
      offVariation: "off",
      defaultVariation: "on",
      // A flag that serves everybody unless a case narrows the rollout; 0 is
      // itself a threshold now, so it would send everyone to the off variation.
      rolloutPercentage: 100,
      bucketBy: "userId",
    },
    rules: [],
    targets: [],
    segments: [],
    subject: { id: "user-1" },
    ...overrides,
  };
}

const CONDITION = {
  attribute: "plan",
  attributeType: "string",
  operator: "equals",
  values: ["beta"],
};

describe("bucketFor", () => {
  it("is deterministic and stays inside 0-99", () => {
    const first = bucketFor("checkout-v2", "user-1");

    expect(bucketFor("checkout-v2", "user-1")).toBe(first);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(100);
  });

  it("includes the flag key, so two flags do not bucket identically", () => {
    const differs = Array.from(
      { length: 200 },
      (_, index) => `user-${index}`,
    ).some(
      (value) => bucketFor("flag-a", value) !== bucketFor("flag-b", value),
    );

    expect(differs).toBe(true);
  });

  it("hashes under the frozen input format", () => {
    // The values are fixed by the algorithm's published input; a different one
    // would reshuffle everybody already bucketed.
    expect(EVALUATION_HASH_VERSION).toBe("v1");
    expect(bucketFor("checkout-v2", "user-1")).toBe(80);
  });
});

describe("evaluate", () => {
  it("serves the off variation for an archived flag", () => {
    expect(
      evaluate(input({ flag: { key: "checkout-v2", status: "archived" } })),
    ).toMatchObject({
      variation: "off",
      enabled: false,
      reason: "flag_archived",
      matchedRuleId: null,
    });
  });

  it("serves the off variation for a disabled flag even when rules exist", () => {
    const outcome = evaluate(
      input({
        config: { ...input().config, enabled: false },
        rules: [
          {
            id: "rule-1",
            conditions: [],
            variation: "on",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
          },
        ],
      }),
    );

    expect(outcome).toMatchObject({ reason: "flag_disabled", enabled: false });
  });

  it("prefers an individual target over a matching rule", () => {
    const outcome = evaluate(
      input({
        targets: [{ userId: "user-1", variationKey: "off" }],
        rules: [
          {
            id: "rule-1",
            conditions: [],
            variation: "on",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
          },
        ],
      }),
    );

    expect(outcome).toMatchObject({
      variation: "off",
      enabled: false,
      reason: "targeting_rule",
      matchedRuleId: null,
    });
  });

  it("serves the first matching rule and reports it", () => {
    const outcome = evaluate(
      input({
        subject: { id: "user-1", plan: "beta" },
        rules: [
          {
            id: "rule-1",
            conditions: [CONDITION],
            variation: "on",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
          },
          {
            id: "rule-2",
            conditions: [],
            variation: "off",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
          },
        ],
      }),
    );

    expect(outcome).toMatchObject({
      reason: "targeting_rule",
      matchedRuleId: "rule-1",
      variation: "on",
    });
  });

  it("requires every condition of a rule to hold", () => {
    const outcome = evaluate(
      input({
        subject: { id: "user-1", plan: "beta", country: "de" },
        rules: [
          {
            id: "rule-1",
            conditions: [
              CONDITION,
              {
                attribute: "country",
                attributeType: "string",
                operator: "equals",
                values: ["us"],
              },
            ],
            variation: "on",
            segmentKeys: [],
            rolloutPercentage: null,
            bucketBy: null,
          },
        ],
      }),
    );

    expect(outcome).toMatchObject({
      reason: "default_variation",
      variation: "on",
      matchedRuleId: null,
    });
  });

  it("matches an attribute by its exact key, not as a path into the subject", () => {
    const rule = (attribute: string) => ({
      id: "rule-1",
      conditions: [{ ...CONDITION, attribute }],
      variation: "on",
      segmentKeys: [],
      rolloutPercentage: null,
      bucketBy: null,
    });
    const subject = { id: "user-1", plan: "beta" };

    // A caller sends `plan`, and the SDK flattens attributes onto the subject, so
    // a rule on `user.plan` names a key nothing sent and must not match.
    expect(evaluate(input({ rules: [rule("plan")], subject }))).toMatchObject({
      reason: "targeting_rule",
      matchedRuleId: "rule-1",
    });
    expect(
      evaluate(input({ rules: [rule("user.plan")], subject })),
    ).toMatchObject({ reason: "default_variation", matchedRuleId: null });
  });
  it("compares numerically, so a version has no ordering to match on", () => {
    // `greater_than` and its siblings resolve both sides with a numeric
    // conversion, and no version string survives it. The dashboard used to
    // suggest `appVersion` as exactly this kind of value and offer the numeric
    // operators, which is a rule that publishes and then matches nobody.
    const rule = (operator: string, values: string[]) => ({
      id: "rule-1",
      conditions: [{ ...CONDITION, attribute: "appVersion", operator, values }],
      variation: "on",
      segmentKeys: [],
      rolloutPercentage: null,
      bucketBy: null,
    });

    const subject = { id: "user-1", appVersion: "2.0.0" };

    for (const operator of [
      "greater_than",
      "greater_than_or_equal",
      "less_than",
      "less_than_or_equal",
    ]) {
      expect(
        evaluate(input({ rules: [rule(operator, ["1.4.0"])], subject })),
      ).toMatchObject({ reason: "default_variation", matchedRuleId: null });
    }

    // Equality is a string comparison, so the same attribute is still usable -
    // and a numeric attribute keeps the ordering.
    expect(
      evaluate(input({ rules: [rule("equals", ["2.0.0"])], subject })),
    ).toMatchObject({ reason: "targeting_rule", matchedRuleId: "rule-1" });
    expect(
      evaluate(
        input({
          rules: [rule("greater_than", ["1"])],
          subject: { id: "user-1", appVersion: 2 },
        }),
      ),
    ).toMatchObject({ reason: "targeting_rule", matchedRuleId: "rule-1" });
  });

  it("treats false and 0 as values, not as an absent attribute", () => {
    const rule = (attribute: string, values: string[]) => ({
      id: "rule-1",
      conditions: [{ ...CONDITION, attribute, operator: "equals", values }],
      variation: "on",
      segmentKeys: [],
      rolloutPercentage: null,
      bucketBy: null,
    });

    const subject = { id: "user-1", beta: false, sessions: 0 };

    expect(
      evaluate(input({ rules: [rule("beta", ["false"])], subject })),
    ).toMatchObject({ reason: "targeting_rule", matchedRuleId: "rule-1" });
    expect(
      evaluate(input({ rules: [rule("sessions", ["0"])], subject })),
    ).toMatchObject({ reason: "targeting_rule", matchedRuleId: "rule-1" });
    expect(
      evaluate(input({ rules: [rule("beta", ["true"])], subject })),
    ).toMatchObject({ reason: "default_variation", matchedRuleId: null });
  });

  it("reports a segment match as the segment reason", () => {
    const rule = {
      id: "rule-1",
      conditions: [],
      variation: "on",
      segmentKeys: ["beta-users"],
      rolloutPercentage: null,
      bucketBy: null,
    };

    const matched = evaluate(
      input({
        subject: { id: "user-1", plan: "beta" },
        rules: [rule],
        segments: [{ key: "beta-users", conditions: [CONDITION] }],
      }),
    );

    expect(matched).toMatchObject({
      reason: "segment",
      matchedRuleId: "rule-1",
    });

    const unmatched = evaluate(
      input({
        subject: { id: "user-1", plan: "free" },
        rules: [rule],
        segments: [{ key: "beta-users", conditions: [CONDITION] }],
      }),
    );

    expect(unmatched).toMatchObject({ reason: "default_variation" });
  });

  it("treats a rule's own rollout as a gate on that rule", () => {
    const base = {
      id: "rule-1",
      conditions: [],
      variation: "off",
      segmentKeys: [],
      bucketBy: null,
    };

    // Nobody buckets at 100 or above, so the rule always applies.
    expect(
      evaluate(input({ rules: [{ ...base, rolloutPercentage: 100 }] })),
    ).toMatchObject({ variation: "off", reason: "targeting_rule" });

    // Everybody buckets at 0 or above, so the rule never applies.
    expect(
      evaluate(input({ rules: [{ ...base, rolloutPercentage: 0 }] })),
    ).toMatchObject({ variation: "on", reason: "default_variation" });
  });

  it("only reports a percentage rollout for a partial one", () => {
    const half = evaluate(
      input({ config: { ...input().config, rolloutPercentage: 50 } }),
    );
    const expected = bucketFor("checkout-v2", "user-1") < 50 ? "on" : "off";

    expect(half).toMatchObject({
      reason: "percentage_rollout",
      variation: expected,
      enabled: expected !== "off",
    });

  });

  it("treats the endpoints as thresholds rather than skipping the bucket", () => {
    // 100% serves the default variation to everyone.
    expect(
      evaluate(
        input({ config: { ...input().config, rolloutPercentage: 100 } }),
      ),
    ).toMatchObject({ reason: "default_variation", variation: "on" });

    // 0% serves the off variation to everyone, rather than the default.
    expect(
      evaluate(input({ config: { ...input().config, rolloutPercentage: 0 } })),
    ).toMatchObject({
      reason: "percentage_rollout",
      variation: "off",
      enabled: false,
    });
  });

  it("buckets by the configured attribute when one is given", () => {
    const config = { ...input().config, bucketBy: "accountId" };

    const first = evaluate(
      input({ config, subject: { id: "u1", accountId: "acme" } }),
    );
    const second = evaluate(
      input({ config, subject: { id: "u2", accountId: "acme" } }),
    );

    // Same account, different user ids: the account decides the bucket.
    expect(first.variation).toBe(second.variation);
  });

  it("falls back to the user id when the bucket attribute is missing", () => {
    const config = {
      ...input().config,
      bucketBy: "accountId",
      rolloutPercentage: 50,
    };
    const withFallback = evaluate(input({ config, subject: { id: "user-1" } }));
    const expected = bucketFor("checkout-v2", "user-1") < 50 ? "on" : "off";

    expect(withFallback.variation).toBe(expected);
  });
});
