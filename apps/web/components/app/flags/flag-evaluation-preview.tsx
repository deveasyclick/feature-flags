"use client";

import { useId, useState } from "react";
import {
  CheckCircle2Icon,
  InfoIcon,
  LoaderCircleIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "lucide-react";
import type {
  EvaluationReason,
  EvaluationResult,
  FlagDetail,
  FlagEnvironmentConfig,
  TargetingRule,
} from "@dariise/contracts";
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
import { ApiError, evaluate } from "@/lib/api";
import { describeCondition, nextDraftId } from "@/lib/targeting";

/** The types an attribute may carry on the wire; the engine reads what it is sent. */
type AttributeValueType = "string" | "number" | "boolean";

interface AttributeRow {
  id: string;
  attribute: string;
  type: AttributeValueType;
  value: string;
}

function newAttributeRow(): AttributeRow {
  return {
    id: nextDraftId("attribute"),
    attribute: "",
    type: "string",
    value: "",
  };
}

/** What each reason means, in the terms of the engine's resolution order. */
const REASON_COPY: Record<
  EvaluationReason,
  { label: string; detail: string }
> = {
  flag_not_found: {
    label: "Flag not found",
    detail:
      "No flag, environment or configuration of that flag resolved in this workspace, so nothing else was consulted.",
  },
  flag_archived: {
    label: "Flag archived",
    detail:
      "An archived flag serves its off variation everywhere, whatever its configuration stored.",
  },
  flag_disabled: {
    label: "Flag off in this environment",
    detail:
      "A disabled flag serves its off variation; no individual target and no rule is consulted.",
  },
  targeting_rule: {
    label: "Targeting rule",
    detail:
      "An individual target matched this subject, or a rule that references no segment did.",
  },
  segment: {
    label: "Targeting rule with segments",
    detail:
      "The matching rule references at least one segment, and every referenced segment resolved and matched.",
  },
  percentage_rollout: {
    label: "Percentage rollout",
    detail:
      "No rule matched, so the subject was bucketed: below the rollout percentage it receives the default variation, at or above it the off variation.",
  },
  default_variation: {
    label: "Default variation",
    detail:
      "No rule matched and the rollout covers everybody, so the default variation is served.",
  },
  error: {
    label: "Error",
    detail: "No source in the API produces this reason today.",
  },
};

function subjectFrom(
  rows: readonly AttributeRow[],
): Record<string, string | number | boolean> {
  return rows.reduce<Record<string, string | number | boolean>>(
    (subject, row) => {
      const attribute = row.attribute.trim();

      subject[attribute] =
        row.type === "number"
          ? Number(row.value)
          : row.type === "boolean"
            ? row.value === "true"
            : row.value;

      return subject;
    },
    {},
  );
}

/** What was sent, so a result the reader has since edited away can say so. */
function subjectKey(id: string, rows: readonly AttributeRow[]): string {
  return JSON.stringify([id.trim(), subjectFrom(rows)]);
}

function validationError(id: string, rows: readonly AttributeRow[]): string | null {
  if (id.trim() === "") return "A subject id is required.";

  const seen = new Set<string>();

  for (const row of rows) {
    const attribute = row.attribute.trim();

    if (attribute === "") return "Every attribute row needs an attribute name.";
    if (attribute === "id") return '"id" is the subject id, which is set above.';
    if (seen.has(attribute)) return `"${attribute}" is listed twice.`;

    seen.add(attribute);

    if (row.type === "number" && !Number.isFinite(Number(row.value))) {
      return `"${attribute}" needs a number.`;
    }
  }

  return null;
}

function matchOf(
  rules: readonly TargetingRule[],
  matchedRuleId: string | null | undefined,
): { rule: TargetingRule; index: number } | null {
  if (!matchedRuleId) return null;

  const index = rules.findIndex((rule) => rule.id === matchedRuleId);
  const rule = rules[index];

  return rule ? { rule, index } : null;
}

/** One rule as the requirements it gatekeeps, not as a verdict on the subject. */
function RuleRow({
  rule,
  index,
  matched,
}: {
  readonly rule: TargetingRule;
  readonly index: number;
  readonly matched: boolean;
}) {
  return (
    <li
      className={
        matched
          ? "border-primary bg-primary/5 rounded-lg border p-3"
          : "rounded-lg border p-3"
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-medium">
          Rule {index + 1}
          <span className="text-muted-foreground ml-1.5 font-normal">
            {rule.description ?? "no description"}
          </span>
        </p>
        <div className="flex items-center gap-2">
          {matched ? (
            <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 text-[10px]">
              matched
            </span>
          ) : null}
          {rule.rollout ? (
            <span className="text-muted-foreground text-[10px]">
              {rule.rollout.percentage}% rollout
            </span>
          ) : null}
          <span className="text-muted-foreground text-[10px]">
            serves <span className="text-foreground font-mono">{rule.variation}</span>
          </span>
        </div>
      </div>

      <p className="text-muted-foreground mt-2 text-[11px] leading-5">
        {rule.conditions.length === 0
          ? "No conditions: this rule matches everybody."
          : rule.conditions.map(describeCondition).join(" · ")}
      </p>

      {rule.segmentKeys.length > 0 ? (
        <p className="text-muted-foreground mt-1 text-[10px]">
          Segments, all of which have to match:{" "}
          <span className="font-mono">{rule.segmentKeys.join(", ")}</span>
        </p>
      ) : null}
    </li>
  );
}

/**
 * Evaluation preview.
 *
 * The endpoint reports the outcome, the reason and which rule served — not the
 * result of each condition, so this screen never invents per-condition
 * verdicts. What it shows about a rule is the stored requirement, restated.
 */
export function FlagEvaluationPreview({
  projectKey,
  flag,
  config,
  rules,
}: {
  readonly projectKey: string;
  readonly flag: FlagDetail;
  /** The environment this screen is scoped to. */
  readonly config: FlagEnvironmentConfig;
  readonly rules: TargetingRule[];
}) {
  const [subjectId, setSubjectId] = useState("");
  const [attributes, setAttributes] = useState<AttributeRow[]>(() => [
    newAttributeRow(),
  ]);
  const [result, setResult] = useState<EvaluationResult | null>(null);
  const [evaluated, setEvaluated] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attributesId = `${useId()}-attributes`;

  const matched = result ? matchOf(rules, result.matchedRuleId) : null;
  const variation = result
    ? flag.variations.find((entry) => entry.key === result.variation)
    : undefined;
  const target = result
    ? config.individualTargets.find((entry) => entry.userId === subjectId.trim())
    : undefined;
  const stale = result !== null && evaluated !== subjectKey(subjectId, attributes);

  function updateAttribute(id: string, patch: Partial<AttributeRow>) {
    setAttributes((previous) =>
      previous.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }

  async function handleEvaluate() {
    if (pending) return;

    const nextError = validationError(subjectId, attributes);

    if (nextError) {
      setError(nextError);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const evaluatedResult = await evaluate({
        flag: flag.key,
        environment: config.environmentKey,
        projectKey,
        user: { id: subjectId.trim(), ...subjectFrom(attributes) },
      });

      setResult(evaluatedResult);
      setEvaluated(subjectKey(subjectId, attributes));
    } catch (cause) {
      setResult(null);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "The evaluation could not be run. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
      <AttributeSuggestions id={attributesId} />

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Subject</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Evaluated in {config.environmentName} as a normal request would be. The
            workspace on this session decides which flags are visible.
          </p>

          <div className="mt-3 space-y-3">
            <div className="space-y-1">
              <Label htmlFor="preview-subject-id" className="text-[11px]">
                subject id
              </Label>
              <Input
                id="preview-subject-id"
                value={subjectId}
                placeholder="user_4821"
                onChange={(event) => setSubjectId(event.target.value)}
                className="h-8 font-mono text-[12px]"
              />
            </div>

            <div className="space-y-2">
              <span className="text-muted-foreground text-[10px] uppercase">
                attributes
              </span>

              {attributes.map((row, index) => (
                <div key={row.id} className="flex flex-wrap items-center gap-2">
                  <Input
                    list={attributesId}
                    value={row.attribute}
                    aria-label={`Attribute ${index + 1}`}
                    placeholder="user.plan"
                    onChange={(event) =>
                      updateAttribute(row.id, { attribute: event.target.value })
                    }
                    className="h-7 w-36 font-mono text-[11px]"
                  />
                  <Select
                    value={row.type}
                    onValueChange={(value) =>
                      updateAttribute(row.id, {
                        type: value as AttributeValueType,
                        value: value === "boolean" ? "true" : row.value,
                      })
                    }
                  >
                    <SelectTrigger
                      size="sm"
                      aria-label={`Type of attribute ${index + 1}`}
                      className="text-[11px]"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="string">string</SelectItem>
                      <SelectItem value="number">number</SelectItem>
                      <SelectItem value="boolean">boolean</SelectItem>
                    </SelectContent>
                  </Select>

                  {row.type === "boolean" ? (
                    <Select
                      value={row.value || "true"}
                      onValueChange={(value) =>
                        updateAttribute(row.id, { value })
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        aria-label={`Value of attribute ${index + 1}`}
                        className="text-[11px]"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="true">true</SelectItem>
                        <SelectItem value="false">false</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      value={row.value}
                      aria-label={`Value of attribute ${index + 1}`}
                      placeholder={row.type === "number" ? "42" : "pro"}
                      onChange={(event) =>
                        updateAttribute(row.id, { value: event.target.value })
                      }
                      className="h-7 min-w-24 flex-1 font-mono text-[11px]"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      setAttributes((previous) =>
                        previous.filter((entry) => entry.id !== row.id),
                      )
                    }
                    aria-label={`Remove attribute ${index + 1}`}
                    className="text-muted-foreground hover:text-danger-ink rounded p-1 transition-colors"
                  >
                    <XIcon aria-hidden="true" className="size-3.5" />
                  </button>
                </div>
              ))}

              <button
                type="button"
                onClick={() =>
                  setAttributes((previous) => [...previous, newAttributeRow()])
                }
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-[11px] underline-offset-2 hover:underline"
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                Add attribute
              </button>
            </div>

            <Button
              size="sm"
              className="w-full gap-1.5 text-[11px]"
              disabled={pending}
              onClick={handleEvaluate}
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <PlayIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Evaluating…" : "Evaluate"}
            </Button>

            {error ? (
              <div className="mt-1">
                <FieldError>{error}</FieldError>
              </div>
            ) : null}
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4" aria-live="polite">
          <h2 className="text-[13px] font-medium">Decision</h2>

          {result === null ? (
            <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-[12px]">
              No evaluation yet. Enter a subject and evaluate to see the variation,
              the reason and the rule that served it.
            </p>
          ) : (
            <>
              <div className="mt-3 flex flex-wrap items-baseline gap-2">
                <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
                  <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
                  serves
                </span>
                <span className="bg-card rounded-md border px-2 py-0.5 font-mono text-[12px]">
                  {result.variation}
                </span>
                {variation ? (
                  <span className="text-muted-foreground text-[11px]">
                    {variation.name} ·{" "}
                    <span className="font-mono">
                      {JSON.stringify(variation.value)}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[11px]">
                    No current variation carries this key.
                  </span>
                )}
              </div>

              <dl className="mt-3 space-y-2 border-t pt-3 text-[11px]">
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">enabled</dt>
                  <dd className="font-mono">
                    {String(result.enabled)}
                    <span className="text-muted-foreground ml-1.5 font-sans">
                      {result.enabled
                        ? "the served variation is not the off variation"
                        : "the decision is the off variation, or the flag is off or archived"}
                    </span>
                  </dd>
                </div>
                <div className="items-center justify-between gap-3 sm:flex">
                  <dt className="text-muted-foreground">reason</dt>
                  <dd className="text-right">
                    <span className="font-mono">{result.reason}</span>
                    <span className="text-muted-foreground ml-1.5">
                      {REASON_COPY[result.reason].label}
                    </span>
                  </dd>
                </div>
              </dl>

              <p className="text-muted-foreground mt-3 border-t pt-3 text-[11px] leading-5">
                {REASON_COPY[result.reason].detail}
              </p>

              {matched ? (
                <p className="mt-2 text-[11px]">
                  Matched{" "}
                  <span className="font-medium">rule {matched.index + 1}</span>
                  {matched.rule.description ? ` — ${matched.rule.description}` : ""}
                  , listed on the right.
                </p>
              ) : null}

              {result.reason === "targeting_rule" && !result.matchedRuleId ? (
                <p className="mt-2 text-[11px]">
                  An individual target matched this subject
                  {target
                    ? `, serving ${target.variationKey}`
                    : ", and it is no longer in this environment's target list"}
                  .
                </p>
              ) : null}

              {result.matchedRuleId && !matched ? (
                <p className="mt-2 text-[11px]">
                  The rule that served is not in the current rule set — the rules
                  changed after this page loaded.
                </p>
              ) : null}

              {stale ? (
                <p className="text-muted-foreground mt-3 inline-flex items-center gap-1.5 border-t pt-3 text-[11px]">
                  <InfoIcon aria-hidden="true" className="size-3.5" />
                  The subject has changed since this evaluation.
                </p>
              ) : null}
            </>
          )}
        </section>

        <section className="bg-card rounded-lg border p-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-[13px] font-medium">
              Rules in {config.environmentName}
            </h2>
            <span className="text-muted-foreground text-[10px]">
              {rules.length} rule{rules.length === 1 ? "" : "s"}
            </span>
          </div>

          <p className="text-muted-foreground mt-1 text-[11px] leading-4">
            The evaluator reports the outcome, the reason and which rule served —
            not which individual condition passed or failed. The requirements below
            are the stored rule, not a verdict on this subject.
          </p>

          {rules.length === 0 ? (
            <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-[12px]">
              No targeting rules in this environment.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {rules.map((rule, index) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  index={index}
                  matched={matched?.rule.id === rule.id}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
