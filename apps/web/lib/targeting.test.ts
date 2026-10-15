import { describe, expect, it } from "vitest";

import {
  conditionDraftsFrom,
  effectiveAttributeType,
  conditionErrors,
  conditionIssues,
  describeConditionRemark,
  firstConditionError,
  formatConditionSummaryText,
  formatRuleSummary,
  isKnownAttribute,
  isSuggestedAttributeType,
  newConditionDraft,
  operatorsForAttributeType,
  suggestedAttributeType,
  targetingAttributeOptions,
  toConditionInputs,
  variationNameOf,
  withAttribute,
  withAttributeType,
  type ConditionDraft,
} from "@/lib/targeting";

/** A condition in the state a reader would leave it in after typing a row. */
function draft(patch: Partial<ConditionDraft> = {}): ConditionDraft {
  return { ...newConditionDraft(), ...patch };
}

const operatorsOfType = (name: string) =>
  operatorsForAttributeType(suggestedAttributeType(name)).map(
    (entry) => entry.value,
  );

describe("a new condition", () => {
  it("starts with no attribute, so nothing is published that was never chosen", () => {
    const condition = newConditionDraft();

    expect(condition.attribute).toBe("");
    expect(condition.attribute.trim()).toBe("");
  });

  it("never defaults to the literal key user.beta", () => {
    // The engine reads `subject[attribute]` literally, so `user.beta` is a key
    // no SDK sends: the condition would publish and then match nobody. The
    // payload is asserted too, because that is what actually ships.
    expect(newConditionDraft().attribute).not.toBe("user.beta");
    expect(toConditionInputs([newConditionDraft()])[0]?.attribute).not.toContain(
      "user.beta",
    );
  });

  it("is incomplete until an attribute and a value are given", () => {
    expect(firstConditionError([newConditionDraft()])).not.toBeNull();
  });

  it("never invents a default from the suggestion list either", () => {
    // The failure this guards is a default that looks plausible and cannot
    // match: whatever a draft is seeded with has to be a key the suggestions
    // themselves call known, or the editor is shipping the bug again.
    for (const option of targetingAttributeOptions) {
      const seeded = newConditionDraft(option.value);

      expect(isKnownAttribute(seeded.attribute)).toBe(true);
      expect(suggestedAttributeType(seeded.attribute)).toBe(option.type);
    }

    // Still empty, so the reader chooses: an empty name is refused, never sent.
    expect(firstConditionError([newConditionDraft()])).not.toBeNull();
  });
});

describe("attribute types decide the controls", () => {
  it("reads beta as boolean", () => {
    expect(suggestedAttributeType("beta")).toBe("boolean");
    expect(operatorsOfType("beta")).toEqual(["equals", "not_equals"]);
  });

  it("reads country as string", () => {
    expect(suggestedAttributeType("country")).toBe("string");
    expect(operatorsOfType("country")).toContain("in");
    expect(operatorsOfType("country")).toContain("matches_regex");
    expect(operatorsOfType("country")).not.toContain("greater_than");
  });

  it("reads id as string", () => {
    expect(suggestedAttributeType("id")).toBe("string");
    expect(operatorsOfType("id")).toContain("equals");
  });

  it("treats an attribute the suggestions do not list as a string", () => {
    expect(suggestedAttributeType("accountTier")).toBe("string");
    expect(suggestedAttributeType("  accountTier  ")).toBe("string");
  });

  it("knows which names the suggestion list carries", () => {
    expect(isKnownAttribute("beta")).toBe(true);
    expect(isKnownAttribute("  country  ")).toBe(true);
    expect(isKnownAttribute("user.beta")).toBe(false);
    expect(isKnownAttribute("")).toBe(false);
  });
});

describe("changing the attribute keeps the operator usable", () => {
  it("falls back when the new type forbids the chosen operator", () => {
    const onNumber = draft({
      attribute: "sessions",
      operator: "greater_than",
      values: "5",
    });

    const moved = withAttribute(onNumber, "beta");

    expect(moved.attribute).toBe("beta");
    expect(operatorsOfType("beta")).toContain(moved.operator);
  });

  it("keeps the operator when the new type allows it", () => {
    const onString = draft({
      attribute: "country",
      operator: "equals",
      values: "NO",
    });

    expect(withAttribute(onString, "plan").operator).toBe("equals");
  });
});

describe("validation", () => {
  it("refuses an empty attribute as an error, not a warning", () => {
    const issues = conditionIssues([draft({ values: "true" })]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toMatch(/attribute/i);
  });

  it("reports a row with no attribute once, not once per missing field", () => {
    // The value is meaningless before the attribute that types it exists, so
    // the reader sees one instruction rather than two faults at once.
    const issues = conditionIssues([newConditionDraft()]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.message).not.toMatch(/value/i);
  });


  it("refuses a condition with no value", () => {
    const issues = conditionIssues([draft({ attribute: "country" })]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("error");
    expect(issues[0]?.message).toContain("country");
  });

  it("warns about an unknown attribute without refusing it", () => {
    // Custom attributes are real: the suggestion list is not the evaluation
    // context, so an unknown name must not block a publish.
    const unknown = draft({ attribute: "user.beta", values: "true" });
    const issues = conditionIssues([unknown]);

    expect(issues).toHaveLength(1);
    expect(issues[0]?.severity).toBe("warning");
    expect(issues[0]?.message).toContain("user.beta");
    expect(issues[0]?.message).toMatch(/exact key/);
    expect(conditionErrors([unknown])).toHaveLength(0);
    expect(firstConditionError([unknown])).toBeNull();
  });

  it("leaves a well-formed condition alone", () => {
    const good = draft({
      attribute: "beta",
      operator: "equals",
      values: "true",
    });

    expect(conditionIssues([good])).toHaveLength(0);
    expect(firstConditionError([good])).toBeNull();
  });

  it("treats a condition list with no conditions as valid match-everybody", () => {
    // Deliberate and unchanged: an empty list is not an incomplete condition.
    expect(conditionIssues([])).toHaveLength(0);
    expect(conditionErrors([])).toHaveLength(0);
    expect(firstConditionError([])).toBeNull();
  });

  it("blames the row it is about, not the list", () => {
    const incomplete = draft();
    const issues = conditionIssues([incomplete]);

    expect(conditionErrors([incomplete]).length).toBeGreaterThan(0);
    expect(issues.map((issue) => issue.id)).toContain(incomplete.id);
  });

  it("names the condition in the message the publish gate shows", () => {
    const message = firstConditionError([
      draft({ attribute: "beta", operator: "equals", values: "" }),
    ]);

    expect(message).toContain("beta");
    expect(message).toContain("value");
  });

  it("can locate an incomplete row that has no attribute yet", () => {
    const message = firstConditionError([draft({ values: "true" })]);

    expect(message).toContain("no attribute chosen");
    expect(message).toContain("true");
  });
});

describe("existing configurations keep working", () => {
  it("round-trips stored conditions through the editor unchanged", () => {
    const stored = [
      {
        id: "condition-1",
        attribute: "beta",
        attributeType: "boolean" as const,
        operator: "equals" as const,
        values: ["true"],
      },
      {
        id: "condition-2",
        attribute: "country",
        attributeType: "string" as const,
        operator: "in" as const,
        values: ["NO", "SE"],
      },
    ];

    expect(toConditionInputs(conditionDraftsFrom(stored))).toEqual([
      {
        attribute: "beta",
        attributeType: "boolean",
        operator: "equals",
        values: ["true"],
      },
      {
        attribute: "country",
        attributeType: "string",
        operator: "in",
        values: ["NO", "SE"],
      },
    ]);
  });

  it("does not flag a custom attribute another client wrote", () => {
    const foreign = conditionDraftsFrom([
      {
        id: "condition-9",
        attribute: "accountTier",
        attributeType: "string" as const,
        operator: "equals" as const,
        values: ["gold"],
      },
    ]);

    expect(firstConditionError(foreign)).toBeNull();
  });
});

describe("the operators a type offers are the ones the engine can decide", () => {
  it("offers the numeric comparisons to numbers", () => {
    expect(operatorsOfType("sessions")).toContain("greater_than");
    expect(operatorsOfType("sessions")).toContain("less_than_or_equal");
  });

  it("withholds them from a version, which the engine would compare numerically", () => {
    // `greater_than` resolves both sides with a numeric conversion, and no
    // string like "1.4.0" survives it, so offering the operator on a version
    // is how a rule gets published that silently matches nobody.
    expect(operatorsOfType("string")).not.toContain("greater_than");
    expect(operatorsForAttributeType("semver")).not.toContainEqual(
      expect.objectContaining({ value: "greater_than" }),
    );
    expect(operatorsForAttributeType("date")).not.toContainEqual(
      expect.objectContaining({ value: "greater_than" }),
    );
  });

  it("suggests no attribute whose ordering the engine cannot make", () => {
    for (const option of targetingAttributeOptions) {
      if (option.type !== "number") {
        const offered = operatorsForAttributeType(option.type).map(
          (entry) => entry.value,
        );

        expect(offered).not.toContain("greater_than");
      }
    }
  });
});

describe("the type on a row", () => {
  it("falls back to the suggestion for an attribute the list names", () => {
    expect(effectiveAttributeType("beta")).toBe("boolean");
    expect(effectiveAttributeType("accountTier")).toBe("string");
  });

  it("uses the type the reader set over the suggestion", () => {
    expect(effectiveAttributeType("sessions", "string")).toBe("string");
    expect(effectiveAttributeType("accountTier", "number")).toBe("number");
  });

  it("sends the type the reader set, so a custom number can be compared", () => {
    const custom = draft({
      attribute: "accountTier",
      attributeType: "number",
      operator: "greater_than",
      values: "2",
    });

    expect(toConditionInputs([custom])[0]?.attributeType).toBe("number");
    expect(firstConditionError([custom])).toBeNull();
  });

  it("keeps an operator the new type can still decide", () => {
    const numeric = draft({
      attribute: "sessions",
      operator: "greater_than",
      values: "5",
    });

    expect(withAttributeType(numeric, "number").operator).toBe("greater_than");
  });

  it("replaces an operator the new type cannot decide", () => {
    const numeric = draft({
      attribute: "sessions",
      operator: "greater_than",
      values: "5",
    });
    const asText = withAttributeType(numeric, "boolean");

    expect(asText.attributeType).toBe("boolean");
    expect(
      operatorsForAttributeType("boolean").map((entry) => entry.value),
    ).toContain(asText.operator);
  });

  it("drops the type from the editor when it matches the suggestion", () => {
    // A stored rule the dashboard agrees with must not be relabelled as a type
    // the reader chose, or every round-trip would claim a decision nobody made.
    const stored = conditionDraftsFrom([
      {
        id: "condition-1",
        attribute: "beta",
        attributeType: "boolean" as const,
        operator: "equals" as const,
        values: ["true"],
      },
    ]);

    expect(stored[0]?.attributeType).toBeUndefined();
  });

  it("keeps a stored type the suggestion does not give", () => {
    const stored = conditionDraftsFrom([
      {
        id: "condition-1",
        attribute: "accountTier",
        attributeType: "number" as const,
        operator: "greater_than" as const,
        values: ["2"],
      },
    ]);

    expect(stored[0]?.attributeType).toBe("number");
    expect(toConditionInputs(stored)[0]?.attributeType).toBe("number");
  });

  it("keeps the type control reachable for a custom key", () => {
    // The selector can only be opened when this is false, and nothing but the
    // selector can set a type - so gating it on "a type was already declared"
    // left a custom number permanently stuck with the text comparisons.
    expect(isSuggestedAttributeType("accountTier")).toBe(false);
    expect(isSuggestedAttributeType("beta")).toBe(true);
  });

  it("asks for a type again once the suggestion is overridden", () => {
    expect(isSuggestedAttributeType("beta", "boolean")).toBe(true);
    expect(isSuggestedAttributeType("beta", "string")).toBe(false);
  });

  it("carries a custom key's chosen type through a round-trip", () => {
    const chosen = withAttributeType(
      draft({ attribute: "accountTier" }),
      "number",
    );

    expect(chosen.attributeType).toBe("number");
    expect(isSuggestedAttributeType(chosen.attribute, chosen.attributeType)).toBe(
      false,
    );
    expect(toConditionInputs([chosen])[0]?.attributeType).toBe("number");
  });
});

describe("values that are real are never read as missing", () => {
  // The engine compares `String(attribute)` against `String(value)`, so false
  // and 0 are ordinary values. A truthiness check anywhere in the editor would
  // turn them into "no value" and refuse a condition that works.
  for (const [name, values] of [
    ["false", "false"],
    ["zero", "0"],
    ["an empty-ish string in a list", "0, false"],
  ] as const) {
    it(`accepts ${name}`, () => {
      const condition = draft({
        attribute: "beta",
        operator: "equals",
        values,
      });

      expect(conditionIssues([condition])).toHaveLength(0);
      expect(toConditionInputs([condition])[0]?.values).toEqual(
        values.split(", "),
      );
      expect(describeConditionRemark(condition)).toContain(values);
    });
  }

  it("still refuses a value list that is genuinely empty", () => {
    const blank = draft({ attribute: "beta", values: "" });

    expect(conditionIssues([blank])).toHaveLength(1);
  });
});

describe("describeConditionRemark", () => {
  it("describes a chosen condition as a sentence", () => {
    expect(
      describeConditionRemark(
        draft({ attribute: "country", operator: "equals", values: "NO" }),
      ),
    ).toBe("country is NO");
  });

  it("says so rather than printing an empty gap", () => {
    expect(describeConditionRemark(draft({ values: "true" }))).toContain(
      "no attribute chosen",
    );
  });
});

describe("the collapsed rule summary", () => {
  it("says a rule with no conditions matches everybody", () => {
    // Not an unfinished rule: the engine reads an empty conjunction that way.

    expect(formatConditionSummaryText([])).toBe("Matches everybody");
  });

  it("joins the conditions into one line", () => {
    const summary = formatConditionSummaryText([
      draft({ attribute: "country", operator: "equals", values: "US" }),
      draft({ attribute: "plan", operator: "equals", values: "Pro" }),
    ]);

    expect(summary).toBe("country is US · plan is Pro");
  });

  it("reads a version as text rather than guessing at a comparison", () => {
    expect(
      formatConditionSummaryText([
        draft({ attribute: "appVersion", operator: "equals", values: "1.4.0" }),
      ]),
    ).toBe("appVersion is 1.4.0");
  });

  it("names the segments a rule also requires", () => {
    const summary = formatRuleSummary({
      conditions: [draft({ attribute: "plan", operator: "equals", values: "Pro" })],
      segmentKeys: ["beta-users"],
    });

    expect(summary).toBe("plan is Pro and in beta-users");
  });

  it("leaves the segments out when there are none", () => {
    expect(
      formatRuleSummary({
        conditions: [draft({ attribute: "plan", operator: "equals", values: "Pro" })],
        segmentKeys: [],
      }),
    ).toBe("plan is Pro");
  });
});

const variations = [
  { key: "off", name: "Off" },
  { key: "on", name: "On" },
];

describe("variationNameOf", () => {
  it("reads a variation key as its name", () => {
    expect(variationNameOf(variations, "on")).toBe("On");
  });

  it("falls back to the key when the variation is gone", () => {
    expect(variationNameOf(variations, "ghost")).toBe("ghost");
  });
});
