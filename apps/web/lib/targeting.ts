import type {
  TargetingAttributeType,
  TargetingCondition,
  TargetingConditionInput,
  TargetingOperator,
} from "@dariise/contracts";

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
  semver: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
  ],
  date: [
    "equals",
    "not_equals",
    "greater_than",
    "greater_than_or_equal",
    "less_than",
    "less_than_or_equal",
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
 * The wire contract takes any attribute name and the engine reads whichever one
 * a condition carries, so these are suggestions rather than a closed set: an
 * attribute no option names is typed `string`, and one another client wrote
 * stays editable here.
 */
export const targetingAttributeOptions: TargetingAttributeOption[] = [
  { value: "user.id", type: "string" },
  { value: "user.beta", type: "boolean" },
  { value: "user.email", type: "string" },
  { value: "user.plan", type: "string" },
  { value: "user.country", type: "string" },
  { value: "user.appVersion", type: "semver" },
  { value: "region", type: "string" },
  { value: "sessions", type: "number" },
];

export function attributeTypeOf(attribute: string): TargetingAttributeType {
  const normalised = attribute.trim();

  return (
    targetingAttributeOptions.find((option) => option.value === normalised)
      ?.type ?? "string"
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

export function newConditionDraft(attribute = "user.beta"): ConditionDraft {
  return {
    id: nextDraftId("condition"),
    attribute,
    operator: "equals",
    values: "",
  };
}

export function conditionDraftsFrom(
  conditions: readonly TargetingCondition[],
): ConditionDraft[] {
  return conditions.map((condition) => ({
    id: nextDraftId("condition"),
    attribute: condition.attribute,
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

export function toConditionInputs(
  drafts: readonly ConditionDraft[],
): TargetingConditionInput[] {
  return drafts.map((draft) => ({
    attribute: draft.attribute.trim(),
    attributeType: attributeTypeOf(draft.attribute),
    operator: draft.operator,
    values: splitValues(draft.values),
  }));
}

/** Keeps the operator one the new attribute's type allows. */
export function withAttribute(
  draft: ConditionDraft,
  attribute: string,
): ConditionDraft {
  const allowed = operatorsForAttributeType(attributeTypeOf(attribute)).map(
    (option) => option.value,
  );

  return {
    ...draft,
    attribute,
    operator: allowed.includes(draft.operator)
      ? draft.operator
      : (allowed[0] ?? draft.operator),
  };
}

/**
 * A condition with no values is refused before it is sent: an empty list
 * matches nobody for the positive operators and everybody for the negations, so
 * it is never what the reader meant.
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
