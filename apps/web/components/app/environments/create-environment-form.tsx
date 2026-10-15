"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FlagIcon, LoaderCircleIcon, RocketIcon } from "lucide-react";
import { cn } from "cn";
import {
  createEnvironmentSchema,
  MAX_PAGE_SIZE,
  toFieldErrors,
  type CreateEnvironmentInput,
  type EnvironmentSummary,
  type FieldErrors,
  type FlagSummary,
  type InitialFlagState,
} from "@iwifunni/contracts";
import {
  ProtectedEnvironmentsNote,
  WhatYouGetCard,
} from "@/components/app/environments/environment-cards";
import {
  environmentColorSwatch,
  environmentColors,
} from "@/components/app/environments/environment-colors";
import { CreateEnvironmentHeader } from "@/components/app/environments/environment-headers";
import { FlagStatePill, flagState } from "@/components/app/flags/flag-state-pill";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { EnvironmentColor } from "@/lib/environment-color";
import * as api from "@/lib/api";
import { toWorkspaceSlug } from "@/lib/validation";

const steps = ["Details", "Flags", "Review"] as const;

const headerClass =
  "text-muted-foreground h-8 px-3 text-[10px] font-medium tracking-[0.1em] uppercase";
const cellClass = "px-3 py-2.5 text-[12px]";

const initialStatusOptions: Array<{
  value: InitialFlagState;
  label: string;
  hint: string;
}> = [
  {
    value: "all-off",
    label: "Start disabled",
    hint: "Every flag starts switched off here",
  },
  {
    value: "copy-source",
    label: "Copy configurations from an environment",
    hint: "Every flag's configuration is copied once, at creation",
  },
];

type CreateEnvironmentField = "name" | "key" | "copyFrom";

type CreateEnvironmentErrors = FieldErrors<CreateEnvironmentField>;

export function CreateEnvironmentForm({
  projectKey,
  environments,
}: {
  readonly projectKey: string;
  readonly environments: EnvironmentSummary[];
}) {
  const defaultSource =
    environments.find((environment) => environment.isDefault)?.key ??
    environments[0]?.key ??
    "";

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [color, setColor] = useState<EnvironmentColor>("primary");
  const [copyFrom, setCopyFrom] = useState(defaultSource);
  const [initialStatus, setInitialStatus] =
    useState<InitialFlagState>("all-off");
  const [editedKey, setEditedKey] = useState(false);
  const [errors, setErrors] = useState<CreateEnvironmentErrors>({});
  const [pending, setPending] = useState(false);
  const [source, setSource] = useState<{
    environmentKey: string;
    flags: FlagSummary[];
  } | null>(null);
  const [sourceError, setSourceError] = useState<{
    environmentKey: string;
    message: string;
  } | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const sourceName =
    environments.find((environment) => environment.key === copyFrom)?.name ?? "";

  // The API copies every flag's configuration from the source when the
  // environment is created, so the preview reads the project's flags and shows
  // how each of them stands in that environment.
  const copiesFromSource = initialStatus === "copy-source";

  useEffect(() => {
    if (!copiesFromSource || step !== 1 || !copyFrom) return;

    const controller = new AbortController();

    api.flags
      .list(projectKey, { limit: MAX_PAGE_SIZE }, { signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setSource({ environmentKey: copyFrom, flags: page.data });
        setSourceError(null);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if ((error as Error)?.name === "AbortError") return;

        setSourceError({
          environmentKey: copyFrom,
          message:
            error instanceof api.ApiError
              ? error.message
              : "The project's flags could not be loaded.",
        });
      });

    return () => controller.abort();
  }, [copiesFromSource, copyFrom, projectKey, step]);

  const sourceFlags = source?.environmentKey === copyFrom ? source.flags : null;
  const sourceLoadError =
    sourceError?.environmentKey === copyFrom ? sourceError.message : null;

  function clearError(field: keyof CreateEnvironmentErrors) {
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

  function input(): CreateEnvironmentInput {
    return {
      name: name.trim(),
      key: key.trim(),
      color,
      initialFlagStatus: initialStatus,
      ...(copiesFromSource && copyFrom ? { copyFrom } : {}),
    };
  }

  function validate(): CreateEnvironmentErrors | null {
    const result = createEnvironmentSchema.safeParse(input());

    if (!result.success) {
      return toFieldErrors<CreateEnvironmentField>(result.error);
    }

    if (environments.some((environment) => environment.key === key.trim())) {
      return { key: "An environment with this key already exists." };
    }

    return null;
  }

  function goToStep(next: number) {
    const nextErrors = validate() ?? {};
    setErrors(nextErrors);

    // Only the first step gates progress; Review is the confirmation.
    if (next > 0 && (nextErrors.name || nextErrors.key)) return;
    setStep(next);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    /**
     * Creation only ever happens from the last step.
     *
     * The Continue and Create Environment buttons sit in the same place in the
     * tree, so without distinct keys React reuses one DOM node and rewrites its
     * `type` from `button` to `submit` mid-click — and the browser submits the
     * form the moment the attribute changes. The keys below stop that; this
     * guard means even an implicit submission cannot create an environment from
     * a step the user has not confirmed.
     */
    if (step !== steps.length - 1) return;

    const nextErrors = validate();
    if (nextErrors) {
      setErrors(nextErrors);
      setStep(0);
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await api.environments.create(projectKey, input(), {
        signal: controller.signal,
      });

      // Straight to the list: the new environment is there, and the SDK key is
      // issued from its own tab rather than from a confirmation step.
      router.push("/environments");
      router.refresh();
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      setErrors({
        form:
          error instanceof api.ApiError
            ? error.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  const previewName = name.trim() || key.trim() || "the new environment";

  const stepLabel = initialStatusOptions.find(
    (option) => option.value === initialStatus,
  )?.label;

  return (
    <form onSubmit={handleSubmit} noValidate>
      <CreateEnvironmentHeader steps={[...steps]} currentStep={step} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.62fr)]">
        <div className="space-y-4">
          {step === 0 ? (
            <section className="bg-card rounded-lg border p-4">
              <h2 className="text-[13px] font-medium">Environment details</h2>

              <div className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Field
                    id="environment-name"
                    label="Name"
                    name="name"
                    placeholder="QA Sandbox"
                    required
                    value={name}
                    error={errors.name}
                    onChange={(event) => handleNameChange(event.target.value)}
                  />
                  <p className="text-muted-foreground text-[11px]">
                    Shown across the dashboard and audit log.
                  </p>
                </div>

                <div className="space-y-2">
                  <Field
                    id="environment-key"
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
                    Used in SDK keys and endpoints. Immutable after creation.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label asChild>
                    <p id="environment-color-label">Color</p>
                  </Label>
                  <RadioGroup
                    value={color}
                    onValueChange={(value) =>
                      setColor(value as EnvironmentColor)
                    }
                    aria-labelledby="environment-color-label"
                    className="flex flex-wrap items-center gap-2.5"
                  >
                    {environmentColors.map((option) => (
                      <RadioGroupItem
                        key={option.value}
                        value={option.value}
                        aria-label={`${option.label} color`}
                        title={option.label}
                        className={cn(
                          "size-6 data-checked:ring-2 data-checked:ring-foreground/40 data-checked:ring-offset-2",
                          environmentColorSwatch[option.value],
                        )}
                      />
                    ))}
                  </RadioGroup>
                </div>
              </div>

              <h3 className="mt-6 text-[13px] font-medium">
                Flag configurations
              </h3>
              <p className="text-muted-foreground mt-1 text-[11px]">
                A flag belongs to the project, so every flag already exists here.
                This environment starts with them all disabled, or copies one
                environment&apos;s configurations once.
              </p>

              <div className="mt-3 space-y-2">
                <Label asChild>
                  <p id="environment-initial-status-label">
                    Starting configurations
                  </p>
                </Label>
                <RadioGroup
                  value={initialStatus}
                  onValueChange={(value) => {
                    setInitialStatus(value as InitialFlagState);
                    clearError("copyFrom");
                  }}
                  aria-labelledby="environment-initial-status-label"
                  className="grid gap-2 sm:grid-cols-2"
                >
                  {initialStatusOptions.map((option) => {
                    const disabled =
                      option.value === "copy-source" &&
                      environments.length === 0;
                    const active = initialStatus === option.value;

                    return (
                      <Label
                        key={option.value}
                        htmlFor={`environment-status-${option.value}`}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 font-normal transition-colors",
                          active
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50",
                          disabled &&
                            "cursor-not-allowed opacity-60 hover:bg-transparent",
                        )}
                      >
                        <RadioGroupItem
                          id={`environment-status-${option.value}`}
                          value={option.value}
                          disabled={disabled}
                          className="mt-0.5"
                        />
                        <span>
                          <span className="block text-[12px] font-medium">
                            {option.label}
                          </span>
                          <span className="text-muted-foreground block text-[10px] leading-4">
                            {disabled
                              ? "No environment to copy from"
                              : option.hint}
                          </span>
                        </span>
                      </Label>
                    );
                  })}
                </RadioGroup>
              </div>

              {copiesFromSource ? (
                <div className="mt-4 space-y-2">
                  <Label htmlFor="environment-copy-from">
                    Copy configurations from
                  </Label>
                  <Select
                    value={copyFrom}
                    onValueChange={(value) => {
                      setCopyFrom(value);
                      clearError("copyFrom");
                    }}
                    disabled={environments.length === 0}
                  >
                    <SelectTrigger
                      id="environment-copy-from"
                      className="h-8 w-full text-[12px]"
                    >
                      <SelectValue placeholder="No other environment" />
                    </SelectTrigger>
                    <SelectContent>
                      {environments.map((environment) => (
                        <SelectItem
                          key={environment.key}
                          value={environment.key}
                        >
                          {environment.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-muted-foreground text-[11px]">
                    Every flag&apos;s configuration in that environment — its
                    enabled state, off and default variations, rollout,
                    targeting rules and individual targets — is copied once, at
                    creation. The two environments are independent afterwards.
                  </p>
                  {errors.copyFrom ? (
                    <FieldError>{errors.copyFrom}</FieldError>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground mt-4 text-[11px]">
                  Nothing is copied. Every flag the project already has starts
                  disabled in {previewName}.
                </p>
              )}
            </section>
          ) : null}

          {step === 1 ? (
            <section className="bg-card rounded-lg border">
              <header className="border-b p-4">
                <h2 className="text-[13px] font-medium">
                  {copiesFromSource
                    ? "Configurations to copy"
                    : "Starting disabled"}
                </h2>
                <p className="text-muted-foreground mt-1 text-[12px]">
                  {copiesFromSource
                    ? `Every flag's configuration in ${sourceName || "the source environment"} is copied once, at creation. Targeting rules and individual targets come with it, and the two environments are independent afterwards.`
                    : `Every flag this project already has starts disabled in ${previewName}.`}
                </p>
              </header>

              {copiesFromSource ? (
                sourceLoadError ? (
                  <p className="text-danger-ink p-4 text-[11px]">
                    {sourceLoadError}
                  </p>
                ) : sourceFlags === null ? (
                  <p className="text-muted-foreground p-4 text-[11px]">
                    Loading {sourceName || "the source environment"}&apos;s
                    flags…
                  </p>
                ) : sourceFlags.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-[11px]">
                    {sourceName || "The source environment"} serves no flag yet,
                    so nothing will be copied.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className={headerClass}>Flag</TableHead>
                        <TableHead className={headerClass}>
                          {`Configuration copied from ${sourceName}`}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sourceFlags.map((flag) => {
                        const state = flag.environments.find(
                          (environment) =>
                            environment.environmentKey === copyFrom,
                        );

                        return (
                          <TableRow key={flag.key}>
                            <TableCell className={cellClass}>
                              <span className="flex items-center gap-2">
                                <FlagIcon
                                  aria-hidden="true"
                                  className="text-muted-foreground size-3.5"
                                />
                                <span className="font-mono text-[12px]">
                                  {flag.key}
                                </span>
                              </span>
                            </TableCell>
                            <TableCell className={cellClass}>
                              {state ? (
                                <FlagStatePill state={flagState(state)} />
                              ) : (
                                <span className="text-muted-foreground text-[11px]">
                                  Disabled
                                </span>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                )
              ) : (
                <p className="text-muted-foreground p-4 text-[11px]">
                  There is nothing to list: the flags keep their default
                  disabled configuration, and no targeting rule or individual
                  target is copied.
                </p>
              )}
            </section>
          ) : null}

          {step === 2 ? (
            <section className="bg-card rounded-lg border p-4">
              <h2 className="text-[13px] font-medium">Review</h2>
              <p className="text-muted-foreground mt-1 text-[12px]">
                Check the configuration before creating the environment.
              </p>

              <dl className="mt-4 divide-y text-[12px]">
                {[
                  ["Name", name || "—"],
                  ["Key", key || "—"],
                  [
                    "Color",
                    environmentColors.find((item) => item.value === color)
                      ?.label ?? color,
                  ],
                  ...(copiesFromSource
                    ? [
                        [
                          "Copy configurations from",
                          sourceName || "the project's default environment",
                        ],
                      ]
                    : []),
                  ["Starting configurations", stepLabel ?? "—"],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-start justify-between gap-4 py-2"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="max-w-[60%] text-right break-words">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4">
                <p className="text-muted-foreground mb-2 text-[11px]">
                  SDK keys are issued separately, from the new environment.
                </p>
                <pre className="bg-muted overflow-x-auto rounded-lg border p-3 text-[11px] leading-5">
                  <code className="font-mono">
                    {JSON.stringify(
                      {
                        name: name.trim(),
                        key: key.trim() || "environment-key",
                        color,
                        copyFrom:
                          copiesFromSource && copyFrom ? copyFrom : null,
                        initialFlagStatus: initialStatus,
                      },
                      null,
                      2,
                    )}
                  </code>
                </pre>
              </div>
            </section>
          ) : null}

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <div className="flex items-center justify-between gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/environments">Cancel</Link>
            </Button>

            <div className="flex items-center gap-2">
              {step > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => goToStep(step - 1)}
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
                  {pending ? "Creating…" : "Create Environment"}
                </Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <WhatYouGetCard />
          <ProtectedEnvironmentsNote />
        </div>
      </div>
    </form>
  );
}
