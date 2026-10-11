"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckIcon,
  LoaderCircleIcon,
  RocketIcon,
} from "lucide-react";
import {
  createSegmentSchema,
  toFieldErrors,
  toWorkspaceSlug,
  type FieldErrors,
} from "@dariise/contracts";
import { CreateSegmentHeader } from "@/components/app/segments/segment-headers";
import {
  countMatchingSampleUsers,
  sampleAudience,
} from "@/components/app/segments/segment-sample";
import { SdkPreview } from "@/components/app/flags/sdk-preview";
import { ConditionList } from "@/components/app/targeting/condition-list";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, segments } from "@/lib/api";
import {
  conditionsNeedValues,
  formatConditionSummary,
  newConditionDraft,
  toConditionInputs,
  type ConditionDraft,
} from "@/lib/targeting";

const steps = ["Details", "Conditions", "Review"] as const;

const tips = [
  "Segments update automatically as attributes change.",
  "Reference a segment in any flag's targeting rules.",
  "Combine conditions with AND (+) to narrow the audience.",
] as const;

type SegmentField = "name" | "key" | "description" | "rules";

function validate(input: unknown): FieldErrors<SegmentField> | null {
  const result = createSegmentSchema.safeParse(input);

  return result.success ? null : toFieldErrors<SegmentField>(result.error);
}

export function CreateSegmentForm({ projectKey }: { readonly projectKey: string }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [description, setDescription] = useState("");
  const [rules, setRules] = useState<ConditionDraft[]>(() => [
    newConditionDraft(),
  ]);
  const [editedKey, setEditedKey] = useState(false);
  const [errors, setErrors] = useState<FieldErrors<SegmentField>>({});
  const [pending, setPending] = useState(false);
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const conditions = useMemo(() => toConditionInputs(rules), [rules]);
  const reach = useMemo(
    () => countMatchingSampleUsers(conditions),
    [conditions],
  );

  function clearError(field: SegmentField) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  function handleNameChange(value: string) {
    setName(value);
    // Keep the key in step with the name until the user takes it over.
    if (!editedKey) setKey(toWorkspaceSlug(value));
    clearError("name");
  }

  function updateRule(id: string, patch: Partial<ConditionDraft>) {
    setRules((previous) =>
      previous.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)),
    );
    clearError("rules");
  }

  function addRule() {
    setRules((previous) => [...previous, newConditionDraft()]);
  }

  function removeRule(id: string) {
    setRules((previous) => previous.filter((rule) => rule.id !== id));
  }

  function payload() {
    const trimmedDescription = description.trim();

    return {
      name: name.trim(),
      key: key.trim(),
      description: trimmedDescription ? trimmedDescription : null,
      rules: toConditionInputs(rules),
    };
  }

  function validateForm(): FieldErrors<SegmentField> {
    const next = { ...validate(payload()) };

    if (conditionsNeedValues(rules)) {
      next.rules = "Every condition needs a value.";
    }

    return next;
  }

  function goToStep(next: number) {
    const nextErrors = validateForm();
    setErrors(nextErrors);
    if (next > 0 && (nextErrors.name || nextErrors.key || nextErrors.description)) {
      return;
    }
    if (next > 1 && nextErrors.rules) return;
    setStep(next);
  }

  function reset() {
    setStep(0);
    setName("");
    setKey("");
    setDescription("");
    setRules([newConditionDraft()]);
    setEditedKey(false);
    setErrors({});
    setCreatedKey(null);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    /**
     * Creation only ever happens from the last step.
     *
     * The Continue and Create buttons sit in the same place in the tree, so
     * without distinct keys React reuses one DOM node and rewrites its `type`
     * from `button` to `submit` mid-click — and the browser submits the form
     * the moment the attribute changes. The keys below stop that; this guard
     * means even an implicit submission cannot create a segment from a step the
     * user has not confirmed.
     */
    if (step !== steps.length - 1) return;

    const nextErrors = validateForm();
    if (
      nextErrors.name ||
      nextErrors.key ||
      nextErrors.description ||
      nextErrors.rules
    ) {
      setErrors(nextErrors);
      setStep(
        nextErrors.name || nextErrors.key || nextErrors.description ? 0 : 1,
      );
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const created = await segments.create(projectKey, payload(), {
        signal: controller.signal,
      });
      setCreatedKey(created.key);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      if (error instanceof ApiError) {
        setErrors(
          error.status === 409 ? { key: error.message } : { form: error.message },
        );
        if (error.status === 409) setStep(0);
      } else {
        setErrors({ form: "The segment could not be created. Please try again." });
      }
    } finally {
      setPending(false);
    }
  }

  if (createdKey) {
    return (
      <>
        <CreateSegmentHeader steps={[...steps]} currentStep={2} />
        <div className="bg-card rounded-lg border p-6">
          <span className="bg-ok-ink/10 text-ok-ink flex size-9 items-center justify-center rounded-lg">
            <CheckIcon aria-hidden="true" className="size-4.5" />
          </span>
          <h2 className="mt-3 text-base font-semibold tracking-tight">
            {name || createdKey} created
          </h2>
          <p className="text-muted-foreground mt-1 max-w-md text-[13px]">
            The segment is saved. Any flag in this project can now reference it
            as <span className="font-mono text-[12px]">{createdKey}</span> from
            its targeting rules.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <Button asChild size="sm">
              <Link href={`/segments/${createdKey}`}>View segment</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/segments">Back to segments</Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              Create another
            </Button>
          </div>
        </div>
      </>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <CreateSegmentHeader steps={[...steps]} currentStep={step} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.55fr)]">
        <div className="space-y-4">
          {step === 0 ? (
            <section className="bg-card rounded-lg border p-4">
              <h2 className="text-[13px] font-medium">Segment details</h2>

              <div className="mt-4 space-y-4">
                <Field
                  id="segment-name"
                  label="Name"
                  name="name"
                  placeholder="Beta Users"
                  required
                  value={name}
                  error={errors.name}
                  onChange={(event) => handleNameChange(event.target.value)}
                />

                <div className="space-y-2">
                  <Field
                    id="segment-key"
                    label="Key"
                    name="key"
                    required
                    value={key}
                    error={errors.key}
                    className="font-mono"
                    onChange={(event) => {
                      setEditedKey(true);
                      setKey(event.target.value);
                      clearError("key");
                    }}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    {key.trim()
                      ? "Used to reference this segment from a flag's targeting rules."
                      : "Lower case and dashes only, e.g. beta-users."}
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="segment-description">Description</Label>
                  <Textarea
                    id="segment-description"
                    name="description"
                    rows={3}
                    placeholder="Who this segment is for and why it exists."
                    value={description}
                    aria-invalid={errors.description ? true : undefined}
                    onChange={(event) => {
                      setDescription(event.target.value);
                      clearError("description");
                    }}
                  />
                  {errors.description ? (
                    <FieldError>{errors.description}</FieldError>
                  ) : null}
                </div>
              </div>
            </section>
          ) : null}

          {step === 1 ? (
            <section className="bg-card rounded-lg border p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-[13px] font-medium">Conditions</h2>
                  <p className="text-muted-foreground mt-1 text-[11px]">
                    A user belongs to the segment when every condition matches.
                  </p>
                </div>
                <span className="bg-primary/10 text-primary rounded-md px-2 py-0.5 text-[10px]">
                  AND
                </span>
              </div>

              <div className="mt-4">
                <ConditionList
                  conditions={rules}
                  emptyLabel="No conditions."
                  onChange={updateRule}
                  onAdd={addRule}
                  onRemove={removeRule}
                />
              </div>

              {errors.rules ? (
                <div className="mt-3">
                  <FieldError>{errors.rules}</FieldError>
                </div>
              ) : null}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="bg-card rounded-lg border p-4">
              <h2 className="text-[13px] font-medium">Review</h2>
              <p className="text-muted-foreground mt-1 text-[12px]">
                Check the segment before creating it.
              </p>

              <dl className="mt-4 divide-y text-[12px]">
                {[
                  ["Name", name || "—"],
                  ["Key", key || "—"],
                  ["Conditions", formatConditionSummary(conditions)],
                  ["Description", description || "—"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-4 py-2"
                  >
                    <dt className="text-muted-foreground shrink-0">{label}</dt>
                    <dd className="max-w-[65%] text-right break-words">{value}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <SdkPreview
                  title="Segment to be created"
                  lines={JSON.stringify(payload(), null, 2).split("\n")}
                />
              </div>
            </section>
          ) : null}

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/segments">Cancel</Link>
            </Button>

            <div className="flex items-center gap-2">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setStep(step - 1)}
                >
                  Back
                </Button>
              ) : null}

              {step < steps.length - 1 ? (
                <Button
                  // Distinct keys keep the two buttons as separate elements:
                  // sharing one DOM node lets the click that advances the step
                  // also flip the node to `type="submit"` and submit the form.
                  key="continue"
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => goToStep(step + 1)}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  key="create"
                  type="submit"
                  size="sm"
                  className="gap-1.5"
                  disabled={pending}
                >
                  {pending ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <RocketIcon aria-hidden="true" className="size-3.5" />
                  )}
                  {pending ? "Creating…" : "Create Segment"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <section className="bg-card rounded-lg border p-4">
            <h2 className="text-[13px] font-medium">Estimated sample reach</h2>
            <p className="mt-2 text-2xl font-semibold tracking-tight">
              {reach.toLocaleString("en-GB")}
            </p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              {reach === 1 ? "sample user matches" : "sample users match"} these
              conditions
            </p>
            <p className="text-muted-foreground mt-3 border-t pt-3 text-[10px]">
              Evaluated in this browser against a fixed sample audience of{" "}
              {sampleAudience.length} users. The API has no membership endpoint,
              so this is not real reach.
            </p>
          </section>

          <section className="bg-card rounded-lg border p-4">
            <h2 className="text-[13px] font-medium">Tips</h2>
            <ul className="mt-3 space-y-2">
              {tips.map((tip) => (
                <li
                  key={tip}
                  className="text-muted-foreground flex items-start gap-2 text-[12px] leading-5"
                >
                  <CheckIcon
                    aria-hidden="true"
                    className="text-ok-ink mt-0.5 size-3.5 shrink-0"
                  />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </form>
  );
}
