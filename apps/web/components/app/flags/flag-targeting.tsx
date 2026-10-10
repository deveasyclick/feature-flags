"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  InfoIcon,
  LoaderCircleIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import type {
  FlagDetail,
  FlagEnvironmentConfig,
  FlagIndividualTarget,
  TargetingCondition,
  TargetingOperator,
  TargetingRule,
  TargetingRuleInput,
} from "@dariise/contracts";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ApiError,
  changeRequests as changeRequestsApi,
  flags as flagsApi,
} from "@/lib/api";

const operatorLabels: Record<TargetingOperator, string> = {
  equals: "equals",
  not_equals: "is not",
  contains: "contains",
  not_contains: "does not contain",
  in: "is one of",
  not_in: "is not one of",
  greater_than: "greater than",
  greater_than_or_equal: "greater than or equal",
  less_than: "less than",
  less_than_or_equal: "less than or equal",
  matches_regex: "matches regex",
};

const operators = Object.keys(operatorLabels) as TargetingOperator[];

let generatedId = 0;

function nextId(prefix: string): string {
  generatedId += 1;
  return `${prefix}-${generatedId}`;
}

/**
 * Targeting tab.
 *
 * Rule and individual-target edits are published through the API: rules with
 * `replaceRules`, targets with `replaceTargets`, and the default variation with
 * the flag flag.
 */
export function FlagTargeting({
  projectKey,
  flagKey,
  flag,
  config,
  rules: initialRules,
  targets: initialTargets,
  updatedLabel,
  approval,
  protectedEnvironment,
}: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly flag: FlagDetail;
  /** The flag's configuration in the environment this screen is scoped to. */
  readonly config: FlagEnvironmentConfig;
  readonly rules: TargetingRule[];
  readonly targets: FlagIndividualTarget[];
  readonly updatedLabel: string;
  /** Approval state for this flag in this environment. */
  readonly approval: React.ReactNode;
  readonly protectedEnvironment: boolean;
}) {
  const [rules, setRules] = useState(initialRules);
  const [targets, setTargets] = useState(initialTargets);
  const [serveDefault, setServeDefault] = useState(config.defaultVariation);
  const [pending, setPending] = useState(false);
  const [published, setPublished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const [submitted, setSubmitted] = useState(false);

  const archived = flag.status === "archived";
  const environmentLabel = config.environmentName;

  function updateCondition(
    ruleId: string,
    conditionId: string,
    patch: Partial<TargetingCondition>,
  ) {
    setRules((previous) =>
      previous.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              conditions: rule.conditions.map((condition) =>
                condition.id === conditionId
                  ? { ...condition, ...patch }
                  : condition,
              ),
            }
          : rule,
      ),
    );
  }

  function updateRule(ruleId: string, patch: Partial<TargetingRule>) {
    setRules((previous) =>
      previous.map((rule) => (rule.id === ruleId ? { ...rule, ...patch } : rule)),
    );
  }

  function addRule() {
    setRules((previous) => [
      ...previous,
      {
        id: nextId("rule"),
        description: null,
        conditions: [
          {
            id: nextId("cond"),
            attribute: "user.id",
            attributeType: "string",
            operator: "in",
            values: [],
          },
        ],
        variation: config.defaultVariation,
        segmentKeys: [],
        rollout: null,
      },
    ]);
  }

  async function handlePublish() {
    if (archived || pending) return;
    setPending(true);
    setPublished(false);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const ruleInputs: TargetingRuleInput[] = rules.map((rule) => ({
      description: rule.description,
      conditions: rule.conditions.map((condition) => ({
        attribute: condition.attribute,
        attributeType: condition.attributeType,
        operator: condition.operator,
        values: condition.values,
      })),
      variation: rule.variation,
      segmentKeys: rule.segmentKeys,
      rollout: rule.rollout,
    }));

    const changesServing = serveDefault !== config.defaultVariation;

    try {
      // A protected environment refuses all three writes, so the whole publish
      // becomes one proposal: one approval decides one coherent change.
      if (protectedEnvironment) {
        await changeRequestsApi.create(
          projectKey,
          flagKey,
          {
            environmentKey: config.environmentKey,
            payload: {
              rules: { rules: ruleInputs },
              targets: { targets },
              ...(changesServing
                ? {
                    config: {
                      enabled: config.enabled,
                      offVariation: config.offVariation,
                      defaultVariation: serveDefault,
                      rolloutPercentage: config.rolloutPercentage,
                      bucketBy: config.bucketBy,
                    },
                  }
                : {}),
            },
          },
          { signal: controller.signal },
        );

        setPublished(false);
        setSubmitted(true);
        router.refresh();
        return;
      }

      await Promise.all([
        flagsApi.replaceRules(
          projectKey,
          flagKey,
          config.environmentKey,
          { rules: ruleInputs },
          { signal: controller.signal },
        ),
        flagsApi.replaceTargets(
          projectKey,
          flagKey,
          config.environmentKey,
          { targets },
          { signal: controller.signal },
        ),
        ...(changesServing
          ? [
              flagsApi.updateEnvironmentConfig(
                projectKey,
                flagKey,
                config.environmentKey,
                {
                  enabled: config.enabled,
                  offVariation: config.offVariation,
                  defaultVariation: serveDefault,
                  rolloutPercentage: config.rolloutPercentage,
                  bucketBy: config.bucketBy,
                },
                { signal: controller.signal },
              ),
            ]
          : []),
      ]);
      setPublished(true);
    } catch (publishError) {
      if ((publishError as Error)?.name === "AbortError") return;

      setError(
        publishError instanceof ApiError
          ? publishError.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
      <div className="space-y-4">
        {archived ? (
          <p className="text-muted-foreground rounded-lg border bg-muted/50 px-3 py-2 text-[11px] leading-4">
            This flag is archived. Every environment serves its off variation, so
            targeting cannot be changed. Restore the flag to edit it.
          </p>
        ) : null}

        {approval}

        <section className="bg-card rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium">Targeting Rules</h2>
              <p className="text-muted-foreground mt-1 text-[11px]">
                Rules are evaluated top to bottom. The first match wins.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Auto segment — coming soon"
              className="gap-1.5 text-[11px]"
            >
              <SparklesIcon aria-hidden="true" className="size-3.5" />
              Auto segment
            </Button>
          </div>

          {rules.length === 0 ? (
            <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
              No targeting rules. Every user receives the default variation.
            </p>
          ) : (
            <ul className="mt-4 space-y-3">
              {rules.map((rule, index) => (
                <li key={rule.id} className="bg-muted/30 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[11px] font-medium">
                      {rule.description ?? `Rule ${index + 1}`}
                      <span className="text-muted-foreground ml-1.5 font-normal">
                        ALL conditions
                      </span>
                    </p>
                    <div className="flex items-center gap-2">
                      {rule.rollout ? (
                        <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px]">
                          {rule.rollout.percentage}% rollout
                        </span>
                      ) : null}
                      <span className="text-muted-foreground text-[10px]">
                        serve
                      </span>
                      <Select
                        value={rule.variation}
                        disabled={archived}
                        onValueChange={(value) =>
                          updateRule(rule.id, { variation: value })
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          aria-label={`Variation served by rule ${index + 1}`}
                          className="text-[11px]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {flag.variations.map((variation) => (
                            <SelectItem
                              key={variation.key}
                              value={variation.key}
                            >
                              {variation.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <ul className="mt-2.5 space-y-2">
                    {rule.conditions.map((condition, conditionIndex) => (
                      <li
                        key={condition.id}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <span className="text-muted-foreground w-7 text-[10px] uppercase">
                          {conditionIndex === 0 ? "if" : "and"}
                        </span>
                        <span className="bg-card rounded-md border px-2 py-1 font-mono text-[11px]">
                          {condition.attribute}
                        </span>
                        <Select
                          value={condition.operator}
                          disabled={archived}
                          onValueChange={(value) =>
                            updateCondition(rule.id, condition.id, {
                              operator: value as TargetingOperator,
                            })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            aria-label={`Operator for ${condition.attribute}`}
                            className="text-[11px]"
                          >
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operators.map((operator) => (
                              <SelectItem key={operator} value={operator}>
                                {operatorLabels[operator]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <span className="bg-card min-w-24 rounded-md border px-2 py-1 font-mono text-[11px]">
                          {condition.values.length > 0
                            ? condition.values.join(", ")
                            : "any"}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-2.5 flex items-center justify-between">
                    <span
                      title="Add condition — coming soon"
                      aria-disabled="true"
                      className="text-muted-foreground/60 text-[10px]"
                    >
                      + Add condition
                    </span>
                    <button
                      type="button"
                      disabled={archived}
                      onClick={() =>
                        setRules((previous) =>
                          previous.filter((item) => item.id !== rule.id),
                        )
                      }
                      className="text-muted-foreground hover:text-danger-ink inline-flex items-center gap-1 text-[10px] underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      <XIcon aria-hidden="true" className="size-3" />
                      Remove rule
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <button
            type="button"
            disabled={archived}
            onClick={addRule}
            className="text-muted-foreground hover:text-foreground mt-3 inline-flex items-center gap-1.5 text-[11px] underline-offset-2 hover:underline disabled:opacity-60"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add targeting rule
          </button>
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Individual Targeting</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Override the variation for specific users.
          </p>

          {targets.length === 0 ? (
            <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
              No individual targets.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {targets.map((target) => (
                <li
                  key={target.userId}
                  className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
                >
                  <span className="font-mono text-[11px]">{target.userId}</span>
                  <div className="flex items-center gap-2">
                    <Select
                      value={target.variationKey}
                      disabled={archived}
                      onValueChange={(value) =>
                        setTargets((previous) =>
                          previous.map((item) =>
                            item.userId === target.userId
                              ? { ...item, variationKey: value }
                              : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Variation for ${target.userId}`}
                        className="text-[11px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {flag.variations.map((variation) => (
                          <SelectItem key={variation.key} value={variation.key}>
                            {variation.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      disabled={archived}
                      onClick={() =>
                        setTargets((previous) =>
                          previous.filter(
                            (item) => item.userId !== target.userId,
                          ),
                        )
                      }
                      className="text-muted-foreground hover:text-danger-ink text-[10px] underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Button
            variant="outline"
            size="sm"
            disabled
            title="Add user — coming soon"
            className="mt-3 gap-1.5 text-[11px]"
          >
            <PlusIcon aria-hidden="true" className="size-3.5" />
            Add user
          </Button>
        </section>
      </div>

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Default Rule</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Served when no targeting rules match.
          </p>

          <div className="mt-3 space-y-2">
            <Label htmlFor="default-serving">Serve variation</Label>
            <Select
              value={serveDefault}
              onValueChange={setServeDefault}
              disabled={archived}
            >
              <SelectTrigger
                id="default-serving"
                className="h-8 w-full text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {flag.variations.map((variation) => (
                  <SelectItem key={variation.key} value={variation.key}>
                    {variation.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <p className="text-muted-foreground mt-3 rounded-md border px-3 py-2 text-[11px]">
            Serving{" "}
            <span className="text-foreground font-mono">
              {
                flag.variations.find(
                  (variation) => variation.key === serveDefault,
                )?.name ?? serveDefault
              }
            </span>{" "}
            to everyone in {environmentLabel} who matches no rule above.
          </p>
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Publish changes</h2>
          <div className="text-muted-foreground mt-2 flex items-center gap-1.5 text-[11px]">
            <InfoIcon aria-hidden="true" className="size-3.5" />
            Last published {updatedLabel}
          </div>

          <Button
            size="sm"
            className="mt-3 w-full gap-1.5 text-[11px]"
            disabled={archived || pending}
            onClick={handlePublish}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending
              ? protectedEnvironment
                ? "Submitting…"
                : "Publishing…"
              : protectedEnvironment
                ? "Submit for approval"
                : "Save & Publish"}
          </Button>

          {error ? (
            <div className="mt-2">
              <FieldError>{error}</FieldError>
            </div>
          ) : null}

          {published ? (
            <p className="text-ok-ink mt-2 inline-flex items-center gap-1.5 text-[11px]">
              <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
              Published just now
            </p>
          ) : null}

          {submitted ? (
            <p className="text-info-ink mt-2 inline-flex items-center gap-1.5 text-[11px]">
              <InfoIcon aria-hidden="true" className="size-3.5" />
              Submitted for approval
            </p>
          ) : null}

          <p className="text-muted-foreground mt-3 border-t pt-3 text-[10px]">
            {environmentLabel} · {rules.length} rule
            {rules.length === 1 ? "" : "s"} · {targets.length} individual target
            {targets.length === 1 ? "" : "s"}
          </p>
        </section>
      </div>
    </div>
  );
}
