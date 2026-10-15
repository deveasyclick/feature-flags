"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  InfoIcon,
  LoaderCircleIcon,
  PlusIcon,
  RotateCcwIcon,
  SaveIcon,
  SparklesIcon,
} from "lucide-react";
import type {
  FlagDetail,
  FlagEnvironmentConfig,
  FlagIndividualTarget,
  SegmentSummary,
  TargetingRule,
  TargetingRuleInput,
  UpdateFlagConfigInput,
} from "@dariise/contracts";
import { RuleCard } from "@/components/app/flags/rule-card";
import { AttributeSuggestions } from "@/components/app/targeting/attribute-suggestions";
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
  firstConditionError,
  newConditionDraft,
  nextDraftId,
  toConditionInputs,
  type ConditionDraft,
} from "@/lib/targeting";

/** A rule's own rollout, as the two fields hold it. Shared with the card. */
export interface RuleRolloutDraft {
  percentage: string;
  bucketBy: string;
}


/** A rule as this screen holds it: the saved shape plus the text being typed. */
export interface RuleDraft {
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

/**
 * Why a rule cannot be published yet, named so the reader can find it.
 *
 * The condition's own message says what is wrong; this adds the rule the
 * condition sits in, because a form holding several rules gives no other way
 * to locate the one that is holding the publish back. A rule with no
 * conditions at all is not this: that is the deliberate match-everybody
 * shape, and it stays valid.
 */
function firstRuleConditionError(rules: readonly RuleDraft[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const message = firstConditionError(rule.conditions);

    if (message) return "Rule " + (index + 1) + ": " + message;
  }

  return null;
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
  /** Which rule shows its editor. One at a time keeps the list scannable. */
  const [expandedRuleId, setExpandedRuleId] = useState<string | null>(null);
  /** The last rule removed, held so the removal can be taken back. */
  const [undoDelete, setUndoDelete] = useState<
    { rule: RuleDraft; index: number } | null
  >(null);
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
    const id = nextDraftId("rule");

    setRules((previous) => [
      ...previous,
      {
        id,
        description: "",
        conditions: [],
        variation: config.defaultVariation,
        segmentKeys: [],
        rollout: null,
      },
    ]);
    // A rule nobody can see is a rule nobody finishes, so the new one opens
    // and the one that was open closes.
    setExpandedRuleId(id);
    setUndoDelete(null);
  }

  /**
   * A copy of a rule, placed directly after it.
   *
   * The conditions are copied rather than shared, because two rules holding one
   * draft would edit each other. The ids are fresh for the same reason: the card
   * keys on them, and a duplicate key would collapse both rows into one.
   */
  function duplicateRule(id: string) {
    const index = rules.findIndex((rule) => rule.id === id);
    const original = rules[index];

    if (!original) return;

    const copy: RuleDraft = {
      ...original,
      id: nextDraftId("rule"),
      conditions: original.conditions.map((condition) => ({
        ...condition,
        id: nextDraftId("condition"),
      })),
      segmentKeys: [...original.segmentKeys],
      rollout: original.rollout ? { ...original.rollout } : null,
    };

    setRules((previous) => {
      const next = [...previous];

      next.splice(index + 1, 0, copy);

      return next;
    });
    setExpandedRuleId(copy.id);
    setUndoDelete(null);
  }

  /**
   * Removes a rule, keeping enough of it to put it back.
   *
   * Deleting is the one action here that can lose work in a single click, and it
   * is reversible only while the draft is unpublished - which is exactly the
   * window this affordance covers.
   */
  function removeRule(id: string) {
    const index = rules.findIndex((rule) => rule.id === id);
    const removed = rules[index];

    if (!removed) return;

    setRules((previous) => previous.filter((rule) => rule.id !== id));
    setUndoDelete({ rule: removed, index });
    setExpandedRuleId((open) => (open === id ? null : open));
  }

  /** Puts the last removed rule back where it was. */
  function restoreRemovedRule() {
    if (!undoDelete) return;

    const { rule, index } = undoDelete;

    setRules((previous) => {
      const next = [...previous];
      // Clamped, because rules may have been removed since: the position is
      // where the reader had it, not a promise the list still has that slot.
      const at = Math.min(Math.max(index, 0), next.length);

      next.splice(at, 0, rule);

      return next;
    });
    setUndoDelete(null);
    setExpandedRuleId(rule.id);
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
    const conditionError = firstRuleConditionError(rules);

    if (conditionError) return conditionError;

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
              Evaluated from top to bottom, and the first rule whose conditions all
              match wins. The order is the priority.
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
            <ul className="mt-4 space-y-2">
              {rules.map((rule, index) => (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  index={index}
                  total={rules.length}
                  expanded={expandedRuleId === rule.id}
                  disabled={archived}
                  variations={flag.variations}
                  segments={segments}
                  attributesId={attributesId}
                  onToggle={() =>
                    setExpandedRuleId((open) => (open === rule.id ? null : rule.id))
                  }
                  onDuplicate={() => duplicateRule(rule.id)}
                  onMove={(offset) => moveRule(index, offset)}
                  onDelete={() => removeRule(rule.id)}
                  onDescription={(description) =>
                    updateRule(rule.id, { description })
                  }
                  onVariation={(variation) => updateRule(rule.id, { variation })}
                  onConditionChange={(conditionId, patch) =>
                    updateCondition(rule.id, conditionId, patch)
                  }
                  onConditionAdd={() => addCondition(rule.id)}
                  onConditionRemove={(conditionId) =>
                    removeCondition(rule.id, conditionId)
                  }
                  onSegmentToggle={(key) => toggleSegment(rule.id, key)}
                  onRolloutToggle={(enabled) => toggleRollout(rule.id, enabled)}
                  onRolloutChange={(rollout) => updateRule(rule.id, { rollout })}
                />
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

        {undoDelete ? (
          <div
            role="status"
            className="bg-muted/50 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
          >
            <p className="text-muted-foreground text-[11px]">
              Deleted rule {undoDelete.index + 1}
              {undoDelete.rule.description.trim()
                ? ": " + undoDelete.rule.description.trim()
                : ""}
              .
            </p>
            <button
              type="button"
              disabled={archived}
              onClick={restoreRemovedRule}
              className="text-foreground inline-flex items-center gap-1.5 text-[11px] underline-offset-2 hover:underline disabled:opacity-60"
            >
              <RotateCcwIcon aria-hidden="true" className="size-3.5" />
              Undo
            </button>
          </div>
        ) : null}
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

        <section className="bg-card sticky bottom-0 z-20 rounded-lg border p-4 shadow-lg">
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
