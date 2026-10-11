import type {
  TargetingAttributeType,
  TargetingConditionInput,
} from "@dariise/contracts";

import { operatorLabels } from "@/lib/targeting";

/**
 * The preview audience.
 *
 * The API exposes no membership endpoint, so a segment's members cannot be
 * fetched. This fixed sample pool is evaluated locally to give the Definition
 * and Members tabs an estimate; every screen that renders it says so.
 */
export interface SampleUser {
  id: string;
  beta: boolean;
  email: string;
  plan: "Free" | "Pro" | "Enterprise";
  region: "EU" | "US" | "NG" | "APAC";
  sessions: number;
}

export const sampleAudience: SampleUser[] = [
  { id: "u_4821", beta: true, email: "ada@acme.io", plan: "Pro", region: "EU", sessions: 42 },
  { id: "u_9930", beta: true, email: "grace@acme.io", plan: "Pro", region: "EU", sessions: 31 },
  { id: "u_2210", beta: true, email: "alan@little.dev", plan: "Pro", region: "US", sessions: 28 },
  { id: "u_1042", beta: true, email: "katherine@acme.io", plan: "Enterprise", region: "US", sessions: 57 },
  { id: "u_7731", beta: true, email: "linus@kernel.org", plan: "Enterprise", region: "EU", sessions: 63 },
  { id: "u_3390", beta: true, email: "margaret@acme.io", plan: "Enterprise", region: "US", sessions: 71 },
  { id: "u_5512", beta: true, email: "barbara@acme.io", plan: "Pro", region: "EU", sessions: 19 },
  { id: "u_8804", beta: true, email: "donald@acme.io", plan: "Pro", region: "US", sessions: 22 },
  { id: "u_6613", beta: true, email: "tim@acme.io", plan: "Pro", region: "APAC", sessions: 15 },
  { id: "u_4457", beta: true, email: "vint@acme.io", plan: "Enterprise", region: "US", sessions: 48 },
  { id: "u_9981", beta: true, email: "radia@acme.io", plan: "Pro", region: "US", sessions: 33 },
  { id: "u_2277", beta: true, email: "leslie@acme.io", plan: "Enterprise", region: "EU", sessions: 51 },
  { id: "u_7408", beta: true, email: "shafi@acme.io", plan: "Pro", region: "APAC", sessions: 26 },
  { id: "u_1120", beta: true, email: "guido@acme.io", plan: "Enterprise", region: "EU", sessions: 60 },
  { id: "u_3366", beta: true, email: "james@acme.io", plan: "Free", region: "NG", sessions: 12 },
  { id: "u_5590", beta: true, email: "anita@acme.io", plan: "Pro", region: "US", sessions: 37 },
  { id: "u_8812", beta: true, email: "jean@acme.io", plan: "Pro", region: "EU", sessions: 24 },
  { id: "u_2035", beta: true, email: "frances@acme.io", plan: "Enterprise", region: "US", sessions: 66 },
  { id: "u_6644", beta: true, email: "ken@acme.io", plan: "Free", region: "NG", sessions: 8 },
  { id: "u_9173", beta: true, email: "bjarne@acme.io", plan: "Enterprise", region: "EU", sessions: 44 },
  { id: "u_3081", beta: true, email: "sophie@acme.io", plan: "Pro", region: "US", sessions: 29 },
  { id: "u_7726", beta: false, email: "dennis@acme.io", plan: "Free", region: "US", sessions: 5 },
  { id: "u_4419", beta: false, email: "brian@acme.io", plan: "Free", region: "EU", sessions: 3 },
  { id: "u_1928", beta: false, email: "barbara2@acme.io", plan: "Free", region: "EU", sessions: 41 },
  { id: "u_5050", beta: false, email: "alex@acme.io", plan: "Free", region: "US", sessions: 2 },
  { id: "u_6155", beta: false, email: "ron@acme.io", plan: "Free", region: "NG", sessions: 9 },
  { id: "u_8307", beta: false, email: "thompson@acme.io", plan: "Free", region: "NG", sessions: 14 },
  { id: "u_3721", beta: false, email: "andrew@acme.io", plan: "Pro", region: "EU", sessions: 27 },
  { id: "u_9482", beta: false, email: "leslie2@acme.io", plan: "Pro", region: "EU", sessions: 45 },
  { id: "u_5638", beta: false, email: "yukihiro@acme.io", plan: "Pro", region: "APAC", sessions: 38 },
  { id: "u_4015", beta: false, email: "brendan@acme.io", plan: "Pro", region: "US", sessions: 52 },
  { id: "u_7340", beta: false, email: "rasmus@acme.io", plan: "Pro", region: "EU", sessions: 17 },
  { id: "u_1902", beta: false, email: "anders@acme.io", plan: "Pro", region: "EU", sessions: 34 },
  { id: "u_6284", beta: false, email: "bjarne2@acme.io", plan: "Enterprise", region: "US", sessions: 58 },
  { id: "u_2468", beta: false, email: "margaret2@acme.io", plan: "Enterprise", region: "APAC", sessions: 62 },
  { id: "u_5913", beta: false, email: "edward@acme.io", plan: "Enterprise", region: "US", sessions: 49 },
  { id: "u_7026", beta: false, email: "ida@acme.io", plan: "Enterprise", region: "EU", sessions: 55 },
  { id: "u_8170", beta: false, email: "shafi2@acme.io", plan: "Pro", region: "APAC", sessions: 21 },
  { id: "u_2350", beta: false, email: "radia2@acme.io", plan: "Pro", region: "US", sessions: 30 },
  { id: "u_3579", beta: false, email: "vint2@acme.io", plan: "Enterprise", region: "US", sessions: 40 },
  { id: "u_6231", beta: false, email: "tim2@acme.io", plan: "Pro", region: "APAC", sessions: 16 },
  { id: "u_8094", beta: false, email: "michael@acme.io", plan: "Pro", region: "EU", sessions: 25 },
  { id: "u_4318", beta: false, email: "james2@acme.io", plan: "Free", region: "NG", sessions: 7 },
  { id: "u_9506", beta: false, email: "anita2@acme.io", plan: "Pro", region: "US", sessions: 36 },
  { id: "u_6135", beta: false, email: "donald2@acme.io", plan: "Pro", region: "US", sessions: 23 },
  { id: "u_1188", beta: false, email: "barbara3@acme.io", plan: "Enterprise", region: "EU", sessions: 53 },
  { id: "u_5482", beta: false, email: "alex2@acme.io", plan: "Free", region: "US", sessions: 11 },
  { id: "u_2793", beta: false, email: "sophie2@acme.io", plan: "Free", region: "EU", sessions: 6 },
  { id: "u_3311", beta: false, email: "ken2@acme.io", plan: "Free", region: "NG", sessions: 13 },
  { id: "u_8846", beta: false, email: "guido2@acme.io", plan: "Pro", region: "EU", sessions: 32 },
  { id: "u_4620", beta: false, email: "ada2@acme.io", plan: "Pro", region: "US", sessions: 39 },
  { id: "u_1637", beta: false, email: "grace2@acme.io", plan: "Enterprise", region: "EU", sessions: 47 },
  { id: "u_5971", beta: false, email: "alan2@acme.io", plan: "Pro", region: "US", sessions: 18 },
  { id: "u_2088", beta: false, email: "dennis2@acme.io", plan: "Free", region: "US", sessions: 4 },
  { id: "u_7465", beta: false, email: "ron2@acme.io", plan: "Free", region: "NG", sessions: 10 },
];

export type SampleField = "id" | "beta" | "email" | "plan" | "region" | "sessions";

const attributeFields: Record<string, SampleField> = {
  "user.beta": "beta",
  beta: "beta",
  "user.email": "email",
  email: "email",
  "user.plan": "plan",
  plan: "plan",
  "user.region": "region",
  region: "region",
  "user.sessions": "sessions",
  sessions: "sessions",
  "user.id": "id",
  id: "id",
};

function normalise(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function scalarEquals(
  actual: unknown,
  expected: string,
  attributeType: TargetingAttributeType,
): boolean {
  if (attributeType === "number") {
    const left = Number(actual);
    const right = Number(expected);
    return Number.isFinite(left) && Number.isFinite(right) && left === right;
  }

  if (attributeType === "boolean") {
    return normalise(expected) === (actual === true ? "true" : "false");
  }

  return normalise(actual) === normalise(expected);
}

function compareNumbers(
  actual: unknown,
  expected: string,
  test: (left: number, right: number) => boolean,
): boolean {
  const left = Number(actual);
  const right = Number(expected);
  return Number.isFinite(left) && Number.isFinite(right) && test(left, right);
}

function matchesCondition(
  condition: TargetingConditionInput,
  user: SampleUser,
): boolean {
  const field = attributeFields[normalise(condition.attribute)];
  if (!field) return false;

  const values = condition.values.map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) return false;

  const actual = user[field];
  const first = values[0] ?? "";

  switch (condition.operator) {
    case "equals":
      return scalarEquals(actual, first, condition.attributeType);
    case "not_equals":
      return !scalarEquals(actual, first, condition.attributeType);
    case "in":
      return values.some((value) =>
        scalarEquals(actual, value, condition.attributeType),
      );
    case "not_in":
      return !values.some((value) =>
        scalarEquals(actual, value, condition.attributeType),
      );
    case "contains":
      return normalise(actual).includes(normalise(first));
    case "not_contains":
      return !normalise(actual).includes(normalise(first));
    case "greater_than":
      return compareNumbers(actual, first, (left, right) => left > right);
    case "greater_than_or_equal":
      return compareNumbers(actual, first, (left, right) => left >= right);
    case "less_than":
      return compareNumbers(actual, first, (left, right) => left < right);
    case "less_than_or_equal":
      return compareNumbers(actual, first, (left, right) => left <= right);
    case "matches_regex":
      try {
        return new RegExp(first, "i").test(String(actual));
      } catch {
        return false;
      }
    default:
      return false;
  }
}

/** Conditions are combined with AND, matching how the API evaluates a segment. */
export function matchesSegment(
  conditions: TargetingConditionInput[],
  user: SampleUser,
): boolean {
  if (conditions.length === 0) return false;
  return conditions.every((condition) => matchesCondition(condition, user));
}

export function matchingSampleUsers(
  conditions: TargetingConditionInput[],
  limit?: number,
): SampleUser[] {
  const matched = sampleAudience.filter((user) =>
    matchesSegment(conditions, user),
  );
  return limit === undefined ? matched : matched.slice(0, limit);
}

export function countMatchingSampleUsers(
  conditions: TargetingConditionInput[],
): number {
  return matchingSampleUsers(conditions).length;
}

export function matchedAttributes(
  conditions: TargetingConditionInput[],
  user: SampleUser,
): string[] {
  return conditions
    .filter((condition) => matchesCondition(condition, user))
    .map(
      (condition) =>
        `${condition.attribute} ${operatorLabels[condition.operator]} ${condition.values.join(", ")}`,
    );
}
