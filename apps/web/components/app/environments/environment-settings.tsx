"use client";

import { useRef, useState } from "react";
import { CheckIcon, LoaderCircleIcon, SaveIcon } from "lucide-react";
import type { EnvironmentDetail } from "@iwifunni/contracts";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";

/**
 * Environment protection.
 *
 * The switch is local state until Save is pressed; the write goes through
 * `environments.updateSettings` and the response's `isProtected` becomes the new
 * baseline, so "Saved" means the API accepted the change rather than a local
 * acknowledgement.
 */
export function EnvironmentSettingsCard({
  projectKey,
  environment,
  disabled = false,
}: {
  readonly projectKey: string;
  readonly environment: Pick<EnvironmentDetail, "key" | "name" | "isProtected">;
  /** An archived environment is read-only until it is restored. */
  readonly disabled?: boolean;
}) {
  const [isProtected, setIsProtected] = useState(environment.isProtected);
  const [baseline, setBaseline] = useState(environment.isProtected);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const dirty = isProtected !== baseline;

  function toggle(value: boolean) {
    setIsProtected(value);
    setSaved(false);
    setError(null);
  }

  async function handleSave() {
    if (pending || !dirty || disabled) return;
    setPending(true);
    setSaved(false);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const updated = await api.environments.updateSettings(
        projectKey,
        environment.key,
        { isProtected },
        { signal: controller.signal },
      );

      setIsProtected(updated.isProtected);
      setBaseline(updated.isProtected);
      setSaved(true);
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setSaved(false);
      setError(
        caught instanceof api.ApiError
          ? caught.message
          : "The settings could not be saved. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">Settings</h2>

      <ul className="mt-2 divide-y">
        <li className="flex items-start justify-between gap-4 py-3 last:pb-0">
          <div className="min-w-0">
            <p className="text-[12px] font-medium">Protected environment</p>
            <p className="text-muted-foreground mt-0.5 text-[11px]">
              Publish flag changes through a change request a second person
              approves
            </p>
          </div>

          <Switch
            checked={isProtected}
            disabled={disabled}
            onCheckedChange={toggle}
            aria-label={`Protected environment in ${environment.name}`}
            className="mt-0.5"
          />
        </li>
      </ul>

      {error ? (
        <div className="mt-3">
          <FieldError>{error}</FieldError>
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
            {disabled
              ? "Archived environments are read-only"
              : dirty
                ? "Unsaved changes"
                : "No changes"}
          </span>
        )}

        <Button
          type="button"
          size="sm"
          className="gap-1.5 text-[11px]"
          disabled={pending || !dirty || disabled}
          onClick={handleSave}
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
  );
}
