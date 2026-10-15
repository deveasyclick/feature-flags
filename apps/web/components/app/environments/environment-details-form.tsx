"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckIcon, LoaderCircleIcon, SaveIcon } from "lucide-react";
import type { UpdateEnvironmentInput } from "@iwifunni/contracts";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, environments } from "@/lib/api";
import { isRequired } from "@/lib/validation";

interface EnvironmentDetailsFormProps {
  readonly projectKey: string;
  readonly environmentKey: string;
  readonly name: string;
  readonly description: string | null;
}

/**
 * Name and description of an environment.
 *
 * The key is shown read-only instead of as a field: applications already
 * resolve this environment through it, so the API refuses to change it.
 */
export function EnvironmentDetailsForm({
  projectKey,
  environmentKey,
  name,
  description,
}: EnvironmentDetailsFormProps) {
  const router = useRouter();
  const [draft, setDraft] = useState({ name, description: description ?? "" });
  const [baseline, setBaseline] = useState({
    name,
    description: description ?? "",
  });
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const dirty =
    draft.name !== baseline.name || draft.description !== baseline.description;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || !dirty) return;

    const missing = isRequired(draft.name, "Environment name");

    if (missing) {
      setNameError(missing);
      setSaved(false);
      return;
    }

    setPending(true);
    setSaved(false);
    setNameError(null);
    setFormError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const input: UpdateEnvironmentInput = {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
    };

    try {
      const updated = await environments.update(
        projectKey,
        environmentKey,
        input,
        { signal: controller.signal },
      );

      const next = {
        name: updated.name,
        description: updated.description ?? "",
      };

      setDraft(next);
      setBaseline(next);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setSaved(false);
      setFormError(
        caught instanceof ApiError
          ? caught.message
          : "The environment could not be saved. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <section className="bg-card rounded-lg border p-4">
        <h2 className="text-[13px] font-medium">Details</h2>

        <div className="mt-4 space-y-4">
          <Field
            id="environment-name"
            label="Name"
            name="name"
            required
            value={draft.name}
            error={nameError}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                name: event.target.value,
              }));
              setSaved(false);
              setNameError(null);
              setFormError(null);
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="environment-description">Description</Label>
            <Textarea
              id="environment-description"
              name="description"
              rows={3}
              value={draft.description}
              placeholder="Used for local development and testing."
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  description: event.target.value,
                }));
                setSaved(false);
                setFormError(null);
              }}
            />
            <p className="text-muted-foreground text-[11px]">
              Optional. Shown on the environment screens; never sent to an SDK.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="environment-key-readonly">Key</Label>
            <p
              id="environment-key-readonly"
              className="bg-muted text-muted-foreground rounded-md border px-3 py-2 font-mono text-[12px]"
            >
              {environmentKey}
            </p>
            <p className="text-muted-foreground text-[11px]">
              Fixed for the life of the environment. Applications resolve
              configurations through it, so it cannot be renamed.
            </p>
          </div>
        </div>

        {formError ? (
          <div className="mt-3">
            <FieldError>{formError}</FieldError>
          </div>
        ) : null}

        <div className="mt-3 flex items-center justify-between gap-3 border-t pt-3">
          {saved && !dirty ? (
            <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
              <CheckIcon aria-hidden="true" className="size-3.5" />
              Saved just now
            </span>
          ) : (
            <span className="text-muted-foreground text-[11px]">
              {dirty ? "Unsaved changes" : "No changes"}
            </span>
          )}

          <Button
            type="submit"
            size="sm"
            className="gap-1.5 text-[11px]"
            disabled={pending || !dirty}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <SaveIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </section>
    </form>
  );
}
