"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckCircle2Icon,
  InfoIcon,
  LoaderCircleIcon,
  PlusIcon,
  SaveIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import type {
  FlagDetail,
  FlagEnvironmentConfig,
  FlagIndividualTarget,
  SegmentSummary,
  TargetingRule,
  TargetingRuleInput,
  UpdateFlagConfigInput,
} from "@dariise/contracts";
import { AttributeSuggestions } from "@/components/app/targeting/attribute-suggestions";
import { ConditionList } from "@/components/app/targeting/condition-list";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, changeRequests as changeRequestsApi, flags as flagsApi } from "@/lib/api";
import {
  conditionDraftsFrom,
  conditionsNeedValues,
  newConditionDraft,
  nextDraftId,
  toConditionInputs,
  type ConditionDraft,
} from "@/lib/targeting";

/** A rule's own rollout, as the two fields hold it. */
interface RuleRolloutDraft {
  percentage: string;
  bucketBy: string;
}

/** A rule as this screen holds it: the saved shape plus the text being typed. */
interface RuleDraft {
  id: string;
  description: string;
  conditions: ConditionDraft[];
  variation: string;
  segmentKeys: string[];
  /** `null` when the rule applies to everyone whose conditions match. */
  rollout: RuleRolloutDraft | null;
}

/**
 * A rule's rollout as the API takes it.
 *
 * The percentage is read from the field's text rather than a number the field
 * never held, and an emptied bucketing attribute falls back to the
 * environment's, which is what the engine does when a rule carries none.
 */
function rolloutInput(
  rollout: RuleRolloutDraft,
  fallbackBucketBy: string,
): { percentage: number; bucketBy: string } {
  return {
    percentage: Number(rollout.percentage.trim()),
    bucketBy: rollout.bucketBy.trim() || fallbackBucketBy,
  };
}

function ruleInputs(
  rules: readonly RuleDraft[],
  fallbackBucketBy: string,
): TargetingRuleInput[] {
  return rules.map((rule) => ({
    description: rule.description.trim() || null,
    conditions: toConditionInputs(rule.conditions),
    variation: rule.variation,
    segmentKeys: rule.segmentKeys,
    rollout: rule.rollout ? rolloutInput(rule.rollout, fallbackBucketBy) : null,
  }));
}

function ruleDraftsFrom(rules: readonly TargetingRule[]): RuleDraft[] {
  return rules.map((rule) => ({
    id: nextDraftId("rule"),
    description: rule.description ?? "",
    conditions: conditionDraftsFrom(rule.conditions),
    variation: rule.variation,
    segmentKeys: rule.segmentKeys,
    rollout: rule.rollout
      ? {
          percentage: String(rule.rollout.percentage),
          bucketBy: rule.rollout.bucketBy,
        }
      : null,
  }));
}

function configInput(
  config: FlagEnvironmentConfig,
  defaultVariation: string,
): UpdateFlagConfigInput {
  return {
    enabled: config.enabled,
    offVariation: config.offVariation,
    defaultVariation,
    rolloutPercentage: config.rolloutPercentage,
    bucketBy: config.bucketBy,
  };
}

/** What the publish button compares against: the whole state, as one string. */
function payloadKey(
  rules: TargetingRuleInput[],
  targets: FlagIndividualTarget[],
  defaultVariation: string,
): string {
  const ordered = [...targets].sort((left, right) =>
    left.userId.localeCompare(right.userId),
  );

  return JSON.stringify({ rules, targets: ordered, defaultVariation });
}

function isWholePercentage(text: string): boolean {
  const trimmed = text.trim();

  if (!/^\d{1,3}$/.test(trimmed)) return false;

  return Number(trimmed) <= 100;
}

/** The percentage and bucketing attribute of one rule's own rollout. */
function RuleRolloutControls({
  rollout,
  index,
  disabled,
  attributesId,
  onChange,
}: {
  readonly rollout: RuleRolloutDraft;
  readonly index: number;
  readonly disabled: boolean;
  readonly attributesId: string;
  readonly onChange: (rollout: RuleRolloutDraft) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={rollout.percentage}
        disabled={disabled}
        inputMode="numeric"
        aria-label={`Rollout percentage for rule ${index + 1}`}
        onChange={(event) => onChange({ ...rollout, percentage: event.target.value })}
        className="h-7 w-16 text-[11px]"
      />
      <span className="text-muted-foreground text-[11px]">
        % of the subjects this rule matches, bucketed by
      </span>
      <Input
        list={attributesId}
        value={rollout.bucketBy}
        disabled={disabled}
        placeholder="userId"
        aria-label={`Bucketing attribute for rule ${index + 1}`}
        onChange={(event) => onChange({ ...rollout, bucketBy: event.target.value })}
        className="h-7 w-36 font-mono text-[11px]"
      />
    </div>
  );
}

/**
 * The segments one rule is gated on: every attached one has to match as well.
 *
 * The project's active segments are toggles. A key that no active segment
 * answers to stays listed because evaluation still resolves an archived one,
 * and dropping it silently would change what the rule serves.
 */
function RuleSegments({
  rule,
  segments,
  index,
  disabled,
  onToggle,
}: {
  readonly rule: RuleDraft;
  readonly segments: SegmentSummary[];
  readonly index: number;
  readonly disabled: boolean;
  readonly onToggle: (key: string) => void;
}) {
  const known = new Set(segments.map((segment) => segment.key));
  const unknown = rule.segmentKeys.filter((key) => !known.has(key));

  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
      <span className="text-muted-foreground mr-0.5 text-[10px] uppercase">
        segments
      </span>

      {segments.map((segment) => {
        const attached = rule.segmentKeys.includes(segment.key);

        return (
          <button
            key={segment.key}
            type="button"
            aria-pressed={attached}
            disabled={disabled}
            onClick={() => onToggle(segment.key)}
            aria-label={`${attached ? "Detach" : "Attach"} segment ${segment.name} ${attached ? "from" : "to"} rule ${index + 1}`}
            className={cn(
              "rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-60",
              attached
                ? "border-primary bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {segment.name}
          </button>
        );
      })}

      {unknown.map((key) => (
        <button
          key={key}
          type="button"
          aria-pressed
          disabled={disabled}
          onClick={() => onToggle(key)}
          title="This segment is not in the project's active list; evaluation still resolves it."
          className="border-primary bg-primary/10 text-primary rounded-md border px-2 py-0.5 font-mono text-[10px] disabled:opacity-60"
        >
          {key}
        </button>
      ))}

      {segments.length === 0 && unknown.length === 0 ? (
        <span className="text-muted-foreground text-[10px]">
          This project has no segments yet.
        </span>
      ) : null}
    </div>
  );
}

/**
 * Targeting tab.
 *
 * Rules, individual targets and the default variation are one environment's
 * state, so they are edited here and published together: `publishTargeting`
 * writes all three in one transaction, and a protected environment takes the
 * same payload as a single change request instead.
 *
 * A rule's conditions decide who it matches, the rule's rollout decides what
 * share of them it applies to, and the order decides who wins — priority is the
 * array's order, which is what the arrows change.
 */
export function FlagTargeting({
  projectKey,
  flagKey,
  flag,
  config,
  rules: initialRules,
  targets: initialTargets,
  segments,
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
  /** The project's active segments, for the rules that reference them. */
  readonly segments: SegmentSummary[];
  readonly updatedLabel: string;
  /** Approval state for this flag in this environment. */
  readonly approval: React.ReactNode;
  readonly protectedEnvironment: boolean;
}) {
  const [rules, setRules] = useState<RuleDraft[]>(() =>
    ruleDraftsFrom(initialRules),
  );
  const [targets, setTargets] = useState<FlagIndividualTarget[]>(() => [
    ...initialTargets,
  ]);
  const [serveDefault, setServeDefault] = useState(config.defaultVariation);
  const [targetUser, setTargetUser] = useState("");
  const [targetVariation, setTargetVariation] = useState(config.defaultVariation);
  const [pending, setPending] = useState(false);
  const [published, setPublished] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState(() =>
    payloadKey(
      ruleInputs(ruleDraftsFrom(initialRules), config.bucketBy),
      initialTargets,
      config.defaultVariation,
    ),
  );
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();
  const attributesId = `${useId()}-attributes`;

  const archived = flag.status === "archived";
  const environmentLabel = config.environmentName;
  const current = payloadKey(
    ruleInputs(rules, config.bucketBy),
    targets,
    serveDefault,
  );
  const dirty = current !== baseline;

  function updateRule(id: string, patch: Partial<RuleDraft>) {
    setRules((previous) =>
      previous.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
  }

  function updateCondition(
    ruleId: string,
    conditionId: string,
    patch: Partial<ConditionDraft>,
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

  function addCondition(ruleId: string) {
    setRules((previous) =>
      previous.map((rule) =>
        rule.id === ruleId
          ? { ...rule, conditions: [...rule.conditions, newConditionDraft()] }
          : rule,
      ),
    );
  }

  function removeCondition(ruleId: string, conditionId: string) {
    setRules((previous) =>
      previous.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              conditions: rule.conditions.filter(
                (condition) => condition.id !== conditionId,
              ),
            }
          : rule,
      ),
    );
  }

  /**
   * A new rule carries no conditions, which is what the engine reads as
   * "matches everybody": that is the shape a percentage split and a first
   * catch-all rule are built from.
   */
  function addRule() {
    setRules((previous) => [
      ...previous,
      {
        id: nextDraftId("rule"),
        description: "",
        conditions: [],
        variation: config.defaultVariation,
        segmentKeys: [],
        rollout: null,
      },
    ]);
  }

  function removeRule(id: string) {
    setRules((previous) => previous.filter((rule) => rule.id !== id));
  }

  function moveRule(index: number, offset: number) {
    setRules((previous) => {
      const next = [...previous];
      const target = index + offset;

      if (target < 0 || target >= next.length) return previous;

      const [moved] = next.splice(index, 1);

      if (moved) next.splice(target, 0, moved);

      return next;
    });
  }

  function toggleRollout(id: string, enabled: boolean) {
    updateRule(id, {
      rollout: enabled ? { percentage: "50", bucketBy: config.bucketBy } : null,
    });
  }

  function toggleSegment(ruleId: string, key: string) {
    setRules((previous) =>
      previous.map((rule) =>
        rule.id === ruleId
          ? {
              ...rule,
              segmentKeys: rule.segmentKeys.includes(key)
                ? rule.segmentKeys.filter((segmentKey) => segmentKey !== key)
                : [...rule.segmentKeys, key],
            }
          : rule,
      ),
    );
  }

  function addTarget() {
    const userId = targetUser.trim();

    if (userId === "") {
      setError("An individual target needs a user id.");
      return;
    }

    // The unique index is the only guard server-side, and a repeat would answer
    // a 500 rather than name the row, so the duplicate is refused here.
    if (targets.some((target) => target.userId === userId)) {
      setError(`"${userId}" already has a target on this flag.`);
      return;
    }

    setTargets((previous) => [
      ...previous,
      { userId, variationKey: targetVariation },
    ]);
    setTargetUser("");
    setError(null);
  }

  function validationError(): string | null {
    if (rules.some((rule) => conditionsNeedValues(rule.conditions))) {
      return "Every condition needs a value.";
    }

    if (
      rules.some(
        (rule) => rule.rollout !== null && !isWholePercentage(rule.rollout.percentage),
      )
    ) {
      return "A rule rollout has to be a whole percentage from 0 to 100.";
    }

    return null;
  }

  async function handlePublish() {
    if (archived || pending) return;

    const nextError = validationError();

    if (nextError) {
      setError(nextError);
      return;
    }

    setPending(true);
    setPublished(false);
    setSubmitted(false);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const nextRules = ruleInputs(rules, config.bucketBy);
    const changesServing = serveDefault !== config.defaultVariation;
    const nextConfig = changesServing
      ? configInput(config, serveDefault)
      : undefined;

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
              rules: { rules: nextRules },
              targets: { targets },
              ...(nextConfig === undefined ? {} : { config: nextConfig }),
            },
          },
          { signal: controller.signal },
        );

        setSubmitted(true);
        router.refresh();
        return;
      }

      const saved = await flagsApi.publishTargeting(
        projectKey,
        flagKey,
        config.environmentKey,
        {
          rules: nextRules,
          targets,
          ...(nextConfig === undefined ? {} : { config: nextConfig }),
        },
        { signal: controller.signal },
      );
      const savedRules = ruleDraftsFrom(saved.rules);

      setRules(savedRules);
      setTargets(saved.individualTargets);
      setServeDefault(saved.defaultVariation);
      setBaseline(
        payloadKey(
          ruleInputs(savedRules, config.bucketBy),
          saved.individualTargets,
          saved.defaultVariation,
        ),
      );
      setPublished(true);
      router.refresh();
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
      <AttributeSuggestions id={attributesId} />

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
                Rules are evaluated top to bottom and the first full match wins.
                The conditions inside one rule are AND-ed.
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
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground text-[10px] uppercase">
                      Rule {index + 1}
                    </span>
                    <Input
                      value={rule.description}
                      disabled={archived}
                      placeholder="What this rule is for"
                      aria-label={`Description for rule ${index + 1}`}
                      onChange={(event) =>
                        updateRule(rule.id, { description: event.target.value })
                      }
                      className="h-7 max-w-56 flex-1 text-[11px]"
                    />

                    <div className="flex items-center gap-2">
                      {rule.rollout ? (
                        <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px]">
                          {rule.rollout.percentage.trim() || "0"}% rollout
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

                      <button
                        type="button"
                        disabled={archived || index === 0}
                        onClick={() => moveRule(index, -1)}
                        aria-label={`Move rule ${index + 1} up`}
                        className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
                      >
                        <ArrowUpIcon aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={archived || index === rules.length - 1}
                        onClick={() => moveRule(index, 1)}
                        aria-label={`Move rule ${index + 1} down`}
                        className="text-muted-foreground hover:text-foreground rounded p-1 transition-colors disabled:opacity-40"
                      >
                        <ArrowDownIcon aria-hidden="true" className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={archived}
                        onClick={() => removeRule(rule.id)}
                        aria-label={`Remove rule ${index + 1}`}
                        className="text-muted-foreground hover:text-danger-ink rounded p-1 transition-colors disabled:opacity-60"
                      >
                        <XIcon aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-2.5">
                    <ConditionList
                      conditions={rule.conditions}
                      attributesId={attributesId}
                      disabled={archived}
                      emptyLabel="No conditions: this rule matches everybody."
                      onChange={(id, patch) =>
                        updateCondition(rule.id, id, patch)
                      }
                      onAdd={() => addCondition(rule.id)}
                      onRemove={(id) => removeCondition(rule.id, id)}
                    />
                  </div>

                  <RuleSegments
                    rule={rule}
                    segments={segments}
                    index={index}
                    disabled={archived}
                    onToggle={(key) => toggleSegment(rule.id, key)}
                  />

                  <div className="mt-2.5 space-y-1.5">
                    <label className="flex items-center gap-2 text-[11px]">
                      <input
                        type="checkbox"
                        checked={rule.rollout !== null}
                        disabled={archived}
                        onChange={(event) =>
                          toggleRollout(rule.id, event.target.checked)
                        }
                        className="size-3.5"
                      />
                      Apply this rule to a percentage of the subjects it matches
                    </label>

                    {rule.rollout ? (
                      <RuleRolloutControls
                        rollout={rule.rollout}
                        index={index}
                        disabled={archived}
                        attributesId={attributesId}
                        onChange={(rollout) =>
                          updateRule(rule.id, { rollout })
                        }
                      />
                    ) : null}
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
            Override the variation for specific users. A target is decided before
            every rule above, but only while the flag is on.
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
                      aria-label={`Remove the target for ${target.userId}`}
                      className="text-muted-foreground hover:text-danger-ink text-[10px] underline-offset-2 hover:underline disabled:opacity-60"
                    >
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Input
              value={targetUser}
              disabled={archived}
              placeholder="user_4821"
              aria-label="User id to target"
              onChange={(event) => setTargetUser(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addTarget();
                }
              }}
              className="h-7 w-40 font-mono text-[11px]"
            />
            <Select
              value={targetVariation}
              disabled={archived}
              onValueChange={setTargetVariation}
            >
              <SelectTrigger
                size="sm"
                aria-label="Variation for the new target"
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archived}
              onClick={addTarget}
              className="gap-1.5 text-[11px]"
            >
              <PlusIcon aria-hidden="true" className="size-3.5" />
              Add user
            </Button>
          </div>
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
              {serveDefault}
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

          <p className="text-muted-foreground mt-3 rounded-md border px-3 py-2 text-[11px] leading-4">
            Rules, individual targets and the default variation publish together
            as one version of {environmentLabel}.
          </p>

          <Button
            size="sm"
            className="mt-3 w-full gap-1.5 text-[11px]"
            disabled={archived || pending || !dirty}
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

          {!dirty && !published && !submitted ? (
            <p className="text-muted-foreground mt-2 text-[11px]">
              No unpublished changes.
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
