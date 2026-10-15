import type {
  TargetingAttributeType,
  TargetingCondition,
  TargetingConditionInput,
  TargetingOperator,
} from "@iwifunni/contracts";

/** How an operator reads in a sentence, on a row and in a summary. */
export const operatorLabels: Record<TargetingOperator, string> = {
  equals: "is",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  in: "is one of",
  not_in: "is not one of",
  greater_than: "greater than",
  greater_than_or_equal: "at least",
  less_than: "less than",
  less_than_or_equal: "at most",
  matches_regex: "matches regex",
};

/**
 * The operators each attribute type may be given.
 *
 * These are the comparisons the engine can actually evaluate, not the ones a
 * type's name suggests. `greater_than` and its three siblings compare numbers
 * only: the engine resolves both sides with a numeric conversion that answers
 * `null` for anything else, so a version or a date put through them is a
 * condition that can never be true. `semver` and `date` therefore keep the
 * string comparisons, which are the ones that work on a value the engine holds
 * as text. Offering a comparison the engine cannot decide is how a rule gets
 * published that silently matches nobody.
 */
const operatorsByType: Record<TargetingAttributeType, TargetingOperator[]> = {
  boolean: ["equals", "not_equals"],
  string: [
    "equals",
    "not_equals",
    "in",
    "not_in",
    "contains",
    "not_contains",
    "matches_regex",
  ],
  number: [
    "equals",
    "not_equals",
    "in",
    "not_in",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
  ],
  // Equal to `string`: the engine has no version ordering to offer.
  semver: [
    "equals",
    "not_equals",
    "in",
    "not_in",
    "contains",
    "not_contains",
    "matches_regex",
  ],
  // Equal to `string`: the engine has no date comparison to offer.
  date: [
    "equals",
    "not_equals",
    "in",
    "not_in",
    "contains",
    "not_contains",
    "matches_regex",
  ],
};

export function operatorsForAttributeType(
  attributeType: TargetingAttributeType,
): Array<{ value: TargetingOperator; label: string }> {
  return operatorsByType[attributeType].map((operator) => ({
    value: operator,
    label: operatorLabels[operator],
  }));
}

export interface TargetingAttributeOption {
  value: string;
  type: TargetingAttributeType;
}

/**
 * The attributes the dashboard suggests.
 *
 * Each name here is the key the evaluating application has to send: the engine
 * reads an attribute with `subject[attribute]`, literally, so `beta` matches a
 * context attribute called `beta` and never one called `user.beta`.
 *
 * They are suggestions, and nothing here is a promise. Two gaps are worth
 * stating, because the editor cannot close either one: this list is not read
 * from any environment, so a name here may be one an application never sends,
 * and the types are the dashboard's guess rather than a declared schema - no
 * attribute carries a type anywhere in the product. A name no option lists is
 * typed `string` and stays editable.
 */
export const targetingAttributeOptions: TargetingAttributeOption[] = [
  { value: "id", type: "string" },
  { value: "beta", type: "boolean" },
  { value: "email", type: "string" },
  { value: "plan", type: "string" },
  { value: "country", type: "string" },
  { value: "region", type: "string" },
  { value: "sessions", type: "number" },
];

/** The type the suggestion list gives an attribute, or `string` for a custom key. */
export function suggestedAttributeType(
  attribute: string,
): TargetingAttributeType {
  const normalised = attribute.trim();

  return (
    targetingAttributeOptions.find((option) => option.value === normalised)
      ?.type ?? "string"
  );
}

/**
 * The type a condition is actually drawn and evaluated with.
 *
 * A reader who sets a type meant it; an unset one means the attribute is one the
 * suggestion list names. `string` is the fallback for a custom key, which is the
 * set of comparisons that works on a value the engine holds as text.
 */
export function effectiveAttributeType(
  attribute: string,
  declared?: TargetingAttributeType,
): TargetingAttributeType {
  return declared ?? suggestedAttributeType(attribute);
}

/**
 * Whether a condition is showing the suggestion list's own type.
 *
 * True only for a suggested attribute the reader has not overridden, which is
 * the one case the editor may present the type as a fact it did not receive a
 * decision about. Everything else - an overridden suggestion, and any custom
 * key, which the list gives no type at all - has to be editable, or a custom
 * number is stuck with the comparisons that only work on text.
 */
export function isSuggestedAttributeType(
  attribute: string,
  declared?: TargetingAttributeType,
): boolean {
  return (
    isKnownAttribute(attribute) &&
    effectiveAttributeType(attribute, declared) ===
      suggestedAttributeType(attribute)
  );
}

/**
 * Whether the option list names this attribute.
 *
 * `false` means "not suggested", never "invalid": an application supplies its
 * own context attributes, so a name this list omits is typed `string` and stays
 * editable. The caller warns about it; nothing here refuses it.
 */
export function isKnownAttribute(attribute: string): boolean {
  const normalised = attribute.trim();

  return targetingAttributeOptions.some(
    (option) => option.value === normalised,
  );
}

/** The example value a field shows for the type it is typed against. */
export function valuePlaceholder(
  attributeType: TargetingAttributeType,
): string {
  switch (attributeType) {
    case "boolean":
      return "true";
    case "number":
      return "42";
    case "semver":
      return "1.4.0";
    case "date":
      return "2026-01-31";
    case "string":
      return "value1, value2";
  }
}

/** A condition as the editor holds it: the values are the field's raw text. */
export interface ConditionDraft {
  id: string;
  attribute: string;
  /**
   * The type the reader set for the attribute, or `undefined` to use the one
   * the suggestion list gives it. The two differ for a custom key, which no
   * suggestion types - and the engine compares numerically whatever the type
   * says, so the operator list is decided by the type that ends up on the row.
   */
  attributeType?: TargetingAttributeType;
  operator: TargetingOperator;
  /** Comma-separated, split when the form submits. */
  values: string;
}

let generatedId = 0;

/** Ids are React keys and form handles only: the API re-keys a rule on publish. */
export function nextDraftId(prefix: string): string {
  generatedId += 1;
  return `${prefix}-${generatedId}`;
}

/**
 * A new condition names no attribute: the reader has to choose one.
 *
 * There is deliberately no default. An attribute is matched by its exact key in
 * the evaluation context, so a plausible-looking default such as `user.beta`
 * names a key the engine never resolves: the condition would validate, save and
 * then silently match nobody, which is the failure the empty placeholder exists
 * to avoid.
 */
export function newConditionDraft(attribute = ""): ConditionDraft {
  return {
    id: nextDraftId("condition"),
    attribute,
    operator: "equals",
    values: "",
  };
}

/** The first operator a type offers, which is what a change of type falls back to. */
function defaultOperatorFor(
  attributeType: TargetingAttributeType,
): TargetingOperator {
  return operatorsByType[attributeType][0] ?? "equals";
}

export function conditionDraftsFrom(
  conditions: readonly TargetingCondition[],
): ConditionDraft[] {
  return conditions.map((condition) => ({
    id: nextDraftId("condition"),
    attribute: condition.attribute,
    // Held only when it differs from the suggestion, so a stored rule the
    // dashboard agrees with keeps reading as "suggested" rather than being
    // relabelled as something the reader chose.
    attributeType:
      condition.attributeType === suggestedAttributeType(condition.attribute)
        ? undefined
        : condition.attributeType,
    operator: condition.operator,
    values: condition.values.join(", "),
  }));
}

export function splitValues(text: string): string[] {
  return text
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * A condition's problem, as the editor and the publish gates read it.
 *
 * `error` is what refuses a publish; `warning` is advisory and never blocks.
 */
export interface ConditionIssue {
  /** The draft the issue belongs to. */
  id: string;
  severity: "error" | "warning";
  message: string;
}

/**
 * What is wrong with each condition in a list.
 *
 * An empty or unknown attribute is the interesting case. Nothing resolves an
 * empty key, so it can never match and is an error. An unknown key may be a
 * typo or may be an attribute this dashboard does not suggest - an application
 * supplies its own - so it warns and stays publishable: this list is not the
 * evaluation context, and reading it as a closed set would refuse rules that
 * work.
 *
 * A missing value is an error for the same reason an empty key is: no value
 * matches nobody for the positive operators and everybody for the negations,
 * so it is never what the reader meant. That rule is unchanged from
 * `conditionsNeedValues`, which stays as the narrower question.
 *
 * The rows report one issue each. A value is meaningless before the attribute
 * that types it exists, so a condition with no attribute reports that alone:
 * naming both at once reads as two faults in a row the reader has only begun.
 */
export function conditionIssues(
  drafts: readonly ConditionDraft[],
): ConditionIssue[] {
  return drafts.flatMap<ConditionIssue>((draft) => {
    const issues: ConditionIssue[] = [];
    const attribute = draft.attribute.trim();
    const quoted = '"' + attribute + '"';

    if (attribute === "") {
      issues.push({
        id: draft.id,
        severity: "error",
        message: "Choose an attribute for this condition.",
      });
    } else if (!isKnownAttribute(attribute)) {
      issues.push({
        id: draft.id,
        severity: "warning",
        message:
          quoted +
          " is not one of the suggested attributes. An attribute is matched by " +
          "its exact key in the evaluation context, so " +
          quoted +
          " reads an attribute of that name and never resolves to anything " +
          "else. Custom attributes are allowed - check the key your SDK sends.",
      });
    }

    if (attribute !== "" && splitValues(draft.values).length === 0) {
      issues.push({
        id: draft.id,
        severity: "error",
        message: "Give " + quoted + " a value.",
      });
    }

    return issues;
  });
}

/** The errors in a list, in the order the rows appear. */
export function conditionErrors(
  drafts: readonly ConditionDraft[],
): ConditionIssue[] {
  return conditionIssues(drafts).filter((issue) => issue.severity === "error");
}

/**
 * The first condition that is holding a publish back, as one sentence.
 *
 * Both publish gates read this, so a rule on the flag screen and a condition
 * in the segment builder are refused in the same words. The row is restated
 * because a form with several conditions gives no other way to find the one
 * the message is about.
 */
export function firstConditionError(
  drafts: readonly ConditionDraft[],
): string | null {
  const issue = conditionErrors(drafts)[0];

  if (!issue) return null;

  const failing = drafts.find((draft) => draft.id === issue.id);

  return failing
    ? `${issue.message} Condition: "${describeConditionRemark(failing)}".`
    : issue.message;
}

/**
 * A condition as a sentence, tolerating the half-built state the editor holds.
 *
 * `describeCondition` is for a condition that has an attribute. This is for one
 * being typed: a review step can still say what the row is, without printing an
 * empty gap where the attribute belongs.
 */
export function describeConditionRemark(condition: ConditionDraft): string {
  const attribute = condition.attribute.trim();
  const values = splitValues(condition.values);
  const comparison = attribute + " " + operatorLabels[condition.operator];

  if (values.length === 0) {
    return attribute === "" ? "(no attribute chosen)" : comparison;
  }

  return (
    (attribute === "" ? "(no attribute chosen) " : "") +
    comparison +
    " " +
    values.join(", ")
  );
}

export function toConditionInputs(
  drafts: readonly ConditionDraft[],
): TargetingConditionInput[] {
  return drafts.map((draft) => ({
    attribute: draft.attribute.trim(),
    attributeType: effectiveAttributeType(draft.attribute, draft.attributeType),
    operator: draft.operator,
    values: splitValues(draft.values),
  }));
}

/**
 * Keeps the operator one the row's type allows.
 *
 * Changing the attribute can change the type - a custom key is a string, a
 * suggestion may be a number - and an operator the new type cannot evaluate
 * would be a condition the engine never matches.
 */
export function withAttribute(
  draft: ConditionDraft,
  attribute: string,
): ConditionDraft {
  const allowed = operatorsForAttributeType(
    effectiveAttributeType(attribute, draft.attributeType),
  ).map((option) => option.value);

  return {
    ...draft,
    attribute,
    operator: allowed.includes(draft.operator)
      ? draft.operator
      : (allowed[0] ?? draft.operator),
  };
}

/**
 * Sets the type the reader chose for an attribute.
 *
 * The operator follows the new type for the same reason it follows a new
 * attribute: a comparison the type cannot make is one the engine cannot decide.
 */
export function withAttributeType(
  draft: ConditionDraft,
  attributeType: TargetingAttributeType,
): ConditionDraft {
  const allowed = operatorsForAttributeType(attributeType).map(
    (option) => option.value,
  );

  return {
    ...draft,
    attributeType,
    operator: allowed.includes(draft.operator)
      ? draft.operator
      : defaultOperatorFor(attributeType),
  };
}

/**
 * Whether any condition in the list has no values.
 *
 * An empty list matches nobody for the positive operators and everybody for the
 * negations, so it is never what the reader meant. `conditionIssues` reports
 * this alongside a missing attribute, with a message per row; this stays as the
 * narrow predicate it always was.
 */
export function conditionsNeedValues(
  drafts: readonly ConditionDraft[],
): boolean {
  return drafts.some((draft) => splitValues(draft.values).length === 0);
}

/** How a condition's values read. The empty list is not "any". */
export function valuesLabel(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "no value";
}

export function describeCondition(condition: {
  attribute: string;
  operator: TargetingOperator;
  values: readonly string[];
}): string {
  return `${condition.attribute} ${operatorLabels[condition.operator]} ${valuesLabel(condition.values)}`;
}

export function formatConditionSummary(
  conditions: ReadonlyArray<{
    attribute: string;
    operator: TargetingOperator;
    values: readonly string[];
  }>,
): string {
  return conditions.length === 0
    ? "No conditions"
    : conditions.map(describeCondition).join(" · ");
}

/**
 * One line for a collapsed rule, from the drafts the editor holds.
 *
 * A rule with no conditions is not an unfinished one: the engine reads an empty
 * conjunction as matching everybody, which is the shape a percentage split and a
 * first catch-all rule are built from. Saying so is more useful than a blank.
 */
export function formatConditionSummaryText(
  conditions: readonly ConditionDraft[],
): string {
  if (conditions.length === 0) return "Matches everybody";

  return conditions.map(describeConditionRemark).join(" · ");
}

/**
 * A collapsed rule's conditions, with any segments it also requires.
 *
 * The served variation is the header's own field rather than part of this
 * sentence: a reader scanning the list reads the conditions to know who the rule
 * catches and the variation to know what they get, and running them together
 * makes both harder to find.
 */
export function formatRuleSummary(rule: {
  conditions: readonly ConditionDraft[];
  segmentKeys: readonly string[];
}): string {
  const segments =
    rule.segmentKeys.length === 0
      ? ""
      : " and in " + rule.segmentKeys.join(", ");

  return formatConditionSummaryText(rule.conditions) + segments;
}

/** A variation key as the name a reader sees, falling back to the key itself. */
export function variationNameOf(
  variations: readonly { key: string; name: string }[],
  key: string,
): string {
  return variations.find((variation) => variation.key === key)?.name ?? key;
}
