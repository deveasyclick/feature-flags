import { z } from "zod";

import { environmentKeySchema } from "#environment";
import { paginationQuerySchema } from "#pagination";
import { resourceKeySchema } from "#slug";

export const FLAG_TYPES = ["boolean", "string", "number", "json"] as const;

export const flagTypeSchema = z.enum(FLAG_TYPES);

export type FlagType = z.infer<typeof flagTypeSchema>;

export const FLAG_STATUSES = ["active", "archived"] as const;

export const flagStatusSchema = z.enum(FLAG_STATUSES);

export type FlagStatus = z.infer<typeof flagStatusSchema>;

/**
 * The targeting vocabulary on the wire.
 *
 * Kept identical to `TARGETING_OPERATORS` in `apps/web/lib/types.ts`. The
 * display strings used by the flag and segment screens ("is one of", "matches")
 * are presentation, and the web app maps them to these values.
 */
export const TARGETING_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "in",
  "not_in",
  "greater_than",
  "greater_than_or_equal",
  "less_than",
  "less_than_or_equal",
  "matches_regex",
] as const;

export const targetingOperatorSchema = z.enum(TARGETING_OPERATORS);

export type TargetingOperator = z.infer<typeof targetingOperatorSchema>;

export const TARGETING_ATTRIBUTE_TYPES = [
  "string",
  "number",
  "boolean",
  "semver",
  "date",
] as const;

export const targetingAttributeTypeSchema = z.enum(TARGETING_ATTRIBUTE_TYPES);

export type TargetingAttributeType = z.infer<
  typeof targetingAttributeTypeSchema
>;

/**
 * A variation's value.
 *
 * Any JSON, because a `json` flag serves structured documents and the column
 * behind this holds `jsonb` either way. Which values a given flag may actually
 * use is decided by its declared `type` — see `variationValueMatchesType` —
 * rather than by this schema, which only says the payload is JSON at all.
 */
export const flagVariationValueSchema = z.json();

export type FlagVariationValue = z.infer<typeof flagVariationValueSchema>;

/**
 * Whether a value is one the flag's declared type can serve.
 *
 * The type is a promise to whoever evaluates the flag: an SDK reading a
 * `string` flag expects a string, and nothing else in the stack enforces that.
 * `json` means a structured document, the one thing the other three cannot
 * express.
 */
export function variationValueMatchesType(
  type: FlagType,
  value: unknown,
): boolean {
  switch (type) {
    case "boolean":
      return typeof value === "boolean";
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "json":
      return typeof value === "object" && value !== null;
  }
}

/**
 * The values a flag of this type starts with, in each environment.
 *
 * Booleans get the obvious pair. The other types get placeholders of the right
 * *shape*, because the guarantee that matters is that a `string` flag serves a
 * string from its first evaluation — the values themselves are meant to be
 * replaced on the flag's configuration tab.
 */
export function defaultVariations(type: FlagType): {
  off: FlagVariationValue;
  on: FlagVariationValue;
} {
  switch (type) {
    case "boolean":
      return { off: false, on: true };
    case "string":
      return { off: "off", on: "on" };
    case "number":
      return { off: 0, on: 1 };
    case "json":
      return { off: {}, on: {} };
  }
}

export const flagVariationSchema = z.object({
  key: z.string().min(1, "Variation key is required."),
  name: z.string().min(1, "Variation name is required."),
  value: flagVariationValueSchema,
  description: z.string().nullable(),
});

export type FlagVariation = z.infer<typeof flagVariationSchema>;

/** A value the flag can serve. Its key is permanent once anything references it. */
export const createFlagVariationSchema = z.object({
  key: z.string().min(1, "Variation key is required."),
  name: z.string().min(1, "Variation name is required."),
  value: flagVariationValueSchema,
  description: z.string().nullable().optional(),
});

export type CreateFlagVariationInput = z.infer<
  typeof createFlagVariationSchema
>;

/** A variation's label or value. The key is an identifier, so it is not here. */
export const updateFlagVariationSchema = z.object({
  name: z.string().min(1, "Variation name is required.").optional(),
  value: flagVariationValueSchema.optional(),
  description: z.string().nullable().optional(),
});

export type UpdateFlagVariationInput = z.infer<
  typeof updateFlagVariationSchema
>;

export const targetingConditionSchema = z.object({
  id: z.string(),
  attribute: z.string().min(1, "Attribute is required."),
  attributeType: targetingAttributeTypeSchema,
  operator: targetingOperatorSchema,
  /** One value for scalar operators, many for `in` and `not_in`. */
  values: z.array(z.string()),
});

export type TargetingCondition = z.infer<typeof targetingConditionSchema>;

export const targetingConditionInputSchema = targetingConditionSchema.omit({
  id: true,
});

export type TargetingConditionInput = z.infer<
  typeof targetingConditionInputSchema
>;

/** A whole-flag percentage rollout. */
export const rolloutSchema = z.object({
  percentage: z.number().int().min(0).max(100),
  bucketBy: z.string().min(1),
  variation: z.string().min(1),
});

export type Rollout = z.infer<typeof rolloutSchema>;

/** The partial rollout a single targeting rule can carry. */
export const ruleRolloutSchema = z.object({
  percentage: z.number().int().min(0).max(100),
  bucketBy: z.string().min(1),
});

export type RuleRollout = z.infer<typeof ruleRolloutSchema>;

export const targetingRuleSchema = z.object({
  id: z.string(),
  description: z.string().nullable(),
  conditions: z.array(targetingConditionSchema),
  variation: z.string().min(1),
  segmentKeys: z.array(z.string()),
  rollout: ruleRolloutSchema.nullable(),
});

export type TargetingRule = z.infer<typeof targetingRuleSchema>;

export const targetingRuleInputSchema = z.object({
  description: z.string().nullable().optional(),
  conditions: z.array(targetingConditionInputSchema),
  variation: z.string().min(1, "A variation to serve is required."),
  segmentKeys: z.array(z.string()).default([]),
  rollout: ruleRolloutSchema.nullable().optional(),
});

export type TargetingRuleInput = z.infer<typeof targetingRuleInputSchema>;

export const flagIndividualTargetSchema = z.object({
  userId: z.string().min(1),
  variationKey: z.string().min(1),
});

export type FlagIndividualTarget = z.infer<
  typeof flagIndividualTargetSchema
>;

export const flagDependencyNodeSchema = z.object({
  key: z.string(),
  status: flagStatusSchema,
  isSelf: z.boolean(),
});

export type FlagDependencyNode = z.infer<typeof flagDependencyNodeSchema>;

export const flagDependencyGraphSchema = z.object({
  upstream: z.array(z.string()),
  downstream: z.array(z.string()),
  summary: z.object({
    upstream: z.number().int().nonnegative(),
    downstream: z.number().int().nonnegative(),
    circular: z.boolean(),
    maxDepth: z.number().int().nonnegative(),
  }),
  evaluationOrder: z.array(flagDependencyNodeSchema),
});

export type FlagDependencyGraph = z.infer<typeof flagDependencyGraphSchema>;

const flagIdentitySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  type: flagTypeSchema,
  tags: z.array(z.string()),
  owner: z.string().nullable(),
  status: flagStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Where a flag is on, for the list row that carries it. The full configuration
 * is `flagEnvironmentConfigSchema`, which the detail screen gets instead.
 */
export const flagEnvironmentSummarySchema = z.object({
  environmentKey: z.string(),
  environmentName: z.string(),
  enabled: z.boolean(),
  rolloutPercentage: z.number().int().min(0).max(100),
});

export type FlagEnvironmentSummary = z.infer<
  typeof flagEnvironmentSummarySchema
>;

/** What one flag does in one environment. */
export const flagEnvironmentConfigSchema = z.object({
  environmentKey: z.string(),
  environmentName: z.string(),
  enabled: z.boolean(),
  offVariation: z.string(),
  defaultVariation: z.string(),
  rolloutPercentage: z.number().int().min(0).max(100),
  bucketBy: z.string(),
  rules: z.array(targetingRuleSchema),
  individualTargets: z.array(flagIndividualTargetSchema),
});

export type FlagEnvironmentConfig = z.infer<
  typeof flagEnvironmentConfigSchema
>;

/**
 * A flag is project-scoped, so a list row carries its identity plus how it stands
 * in every environment of the project. The full configuration for one environment
 * is `flagEnvironmentConfigSchema`, which the environment-scoped read returns.
 */
export const flagSummarySchema = flagIdentitySchema.extend({
  environments: z.array(flagEnvironmentSummarySchema),
});

export type FlagSummary = z.infer<typeof flagSummarySchema>;

/** One flag read on its own: the same summary plus the values it can serve. */
export const flagDetailSchema = flagSummarySchema.extend({
  variations: z.array(flagVariationSchema),
});

export type FlagDetail = z.infer<typeof flagDetailSchema>;

export const flagVersionSchema = z.object({
  version: z.number().int().positive(),
  environmentKey: z.string(),
  description: z.string().nullable(),
  author: z.string(),
  serve: z.string().nullable(),
  createdAt: z.string(),
});

export type FlagVersion = z.infer<typeof flagVersionSchema>;

/**
 * One value a flag is created with.
 *
 * `name` is omitted by callers that do not care to label their variations, and
 * the API derives a label from the key. `value` is what the flag serves; `key`
 * is the identifier every environment's configuration and targeting rule points
 * at, which is why a flag with three or more values has to name each of them.
 */
export const flagCreationVariationSchema = z.object({
  key: z.string().trim().min(1, "A variation key is required."),
  name: z.string().trim().min(1).max(80).optional(),
  value: flagVariationValueSchema,
});

export type FlagCreationVariation = z.infer<
  typeof flagCreationVariationSchema
>;

export const createFlagSchema = z
  .object({
    key: resourceKeySchema,
    name: z
      .string()
      .trim()
      .min(1, "Flag name is required.")
      .max(80, "Flag name must be at most 80 characters."),
    description: z.string().trim().max(280).nullable().optional(),
    type: flagTypeSchema.default("boolean"),
    tags: z.array(z.string().trim().min(1)).default([]),
    owner: z.string().trim().min(1).nullable().optional(),
    /**
     * Every value the flag starts with, in order, plus the two the environment
     * selects. All three are omitted together by a caller content with the
     * conventional `on`/`off` pair, which the API seeds.
     */
    variations: z
      .array(flagCreationVariationSchema)
      .min(1, "A flag needs at least one variation.")
      .optional(),
    /** The variation served when the flag is on and nothing else selects one. */
    defaultVariation: z.string().trim().min(1).optional(),
    /** The variation served when the flag is off, and as the SDK's fallback. */
    offVariation: z.string().trim().min(1).optional(),
  })
  .superRefine((input, ctx) => {
    const declared = [
      input.variations ?? null,
      input.defaultVariation ?? null,
      input.offVariation ?? null,
    ];

    if (declared.every((entry) => entry === null)) return;

    if (declared.some((entry) => entry === null)) {
      ctx.addIssue({
        code: "custom",
        path: ["variations"],
        message:
          "variations, defaultVariation and offVariation have to be given together.",
      });

      return;
    }

    const variations = input.variations!;

    for (const [index, variation] of variations.entries()) {
      if (!variationValueMatchesType(input.type, variation.value)) {
        ctx.addIssue({
          code: "custom",
          path: ["variations", index, "value"],
          message: `Every value of a ${input.type} flag has to be a ${input.type}.`,
        });
      }
    }

    const keys = variations.map((variation) => variation.key);

    if (new Set(keys).size !== keys.length) {
      ctx.addIssue({
        code: "custom",
        path: ["variations"],
        message: "Every variation needs a different key.",
      });
    }

    for (const [field, key] of [
      ["defaultVariation", input.defaultVariation!],
      ["offVariation", input.offVariation!],
    ] as const) {
      if (!keys.includes(key)) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: `"${key}" is not one of the variations this flag is created with.`,
        });
      }
    }

    // Every other type keeps the conventional `on`/`off` pair, which targeting
    // rules and the SDK preview already assume; a string flag names its own.
    if (input.type !== "string") {
      for (const key of keys) {
        if (key !== "on" && key !== "off") {
          ctx.addIssue({
            code: "custom",
            path: ["variations"],
            message:
              "Only a string flag can be created with a variation list of its own.",
          });

          break;
        }
      }
    }
  });

export type CreateFlagInput = z.infer<typeof createFlagSchema>;

export const updateFlagSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(280).nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  owner: z.string().trim().min(1).nullable().optional(),
});

export type UpdateFlagInput = z.infer<typeof updateFlagSchema>;

/** What one environment's configuration publishes. Variations belong to the flag. */
export const updateFlagConfigSchema = z.object({
  enabled: z.boolean(),
  offVariation: z.string().min(1),
  defaultVariation: z.string().min(1),
  rolloutPercentage: z.number().int().min(0).max(100),
  bucketBy: z.string().min(1),
});

export type UpdateFlagConfigInput = z.infer<typeof updateFlagConfigSchema>;

/**
 * The one-field switch behind the flag list's quick toggle.
 *
 * Deliberately narrower than `updateFlagConfigSchema`: a list row has no opinion
 * about variations or rollout, and sending the whole configuration would make the
 * toggle a read-modify-write over fields the reader never saw.
 */
export const setFlagEnabledSchema = z.object({
  enabled: z.boolean(),
});

export type SetFlagEnabledInput = z.infer<typeof setFlagEnabledSchema>;

export const replaceTargetingRulesSchema = z.object({
  rules: z.array(targetingRuleInputSchema),
});

export type ReplaceTargetingRulesInput = z.infer<
  typeof replaceTargetingRulesSchema
>;

export const replaceIndividualTargetsSchema = z.object({
  targets: z.array(flagIndividualTargetSchema),
});

export type ReplaceIndividualTargetsInput = z.infer<
  typeof replaceIndividualTargetsSchema
>;

export const flagListQuerySchema = paginationQuerySchema.extend({
  /** Case-insensitive match on key or name. */
  search: z.string().trim().optional(),
  status: flagStatusSchema.optional(),
  /** Narrows each row to that environment's state; all of them are returned otherwise. */
  environmentKey: environmentKeySchema.optional(),
});

export type FlagListQuery = z.infer<typeof flagListQuerySchema>;

/**
 * The workspace-wide list renders outside any project, and flag keys are unique
 * per project rather than per workspace, so each row carries its project key.
 */
export const workspaceFlagSummarySchema = flagSummarySchema.extend({
  projectKey: z.string(),
});

export type WorkspaceFlagSummary = z.infer<typeof workspaceFlagSummarySchema>;

export const workspaceFlagListQuerySchema = flagListQuerySchema.extend({
  projectKey: z.string().optional(),
});

export type WorkspaceFlagListQuery = z.infer<
  typeof workspaceFlagListQuerySchema
>;
