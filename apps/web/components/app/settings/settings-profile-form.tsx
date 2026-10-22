"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import {
  toFieldErrors,
  updateWorkspaceSchema,
  type EnvironmentSummary,
  type UpdateWorkspaceInput,
  type WorkspaceProfile,
} from "@iwifunni/contracts";
import { SettingsCard } from "@/components/app/settings-card";
import {
  timezoneChoices,
  workspaceUrl,
} from "@/components/app/settings/settings-options";
import { Field, FieldError } from "@/components/auth/field";
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
import * as api from "@/lib/api";

interface ProfileErrors {
  form?: string;
  name?: string;
}

interface ProfileDraft {
  name: string;
  defaultEnvironmentKey: string | null;
  timezone: string;
}

function resolveEnvironmentKey(
  defaultEnvironmentId: string | null,
  environments: EnvironmentSummary[],
): string | null {
  if (!defaultEnvironmentId) return null;

  return (
    environments.find((environment) => environment.id === defaultEnvironmentId)
      ?.key ?? null
  );
}

function toDraft(
  profile: WorkspaceProfile,
  environments: EnvironmentSummary[],
): ProfileDraft {
  return {
    name: profile.name,
    defaultEnvironmentKey: resolveEnvironmentKey(
      profile.defaultEnvironmentId,
      environments,
    ),
    timezone: profile.timezone,
  };
}

export function SettingsProfileForm({
  profile,
  environments,
}: {
  readonly profile: WorkspaceProfile;
  readonly environments: EnvironmentSummary[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<ProfileDraft>(() =>
    toDraft(profile, environments),
  );
  const [baseline, setBaseline] = useState<ProfileDraft>(() =>
    toDraft(profile, environments),
  );
  const [defaultEnvironmentId, setDefaultEnvironmentId] = useState(
    profile.defaultEnvironmentId,
  );
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const dirty =
    draft.name !== baseline.name ||
    draft.defaultEnvironmentKey !== baseline.defaultEnvironmentKey ||
    draft.timezone !== baseline.timezone;

  const unresolvedDefault =
    defaultEnvironmentId !== null && draft.defaultEnvironmentKey === null;

  function update(patch: Partial<ProfileDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setErrors((current) => ({ ...current, form: undefined, name: undefined }));
  }

  async function handleSave() {
    if (pending || !dirty) return;

    const patch: UpdateWorkspaceInput = {};
    const name = draft.name.trim();

    if (name !== baseline.name) patch.name = name;
    if (draft.defaultEnvironmentKey !== baseline.defaultEnvironmentKey) {
      patch.defaultEnvironmentKey = draft.defaultEnvironmentKey;
    }
    if (draft.timezone !== baseline.timezone) patch.timezone = draft.timezone;

    const parsed = updateWorkspaceSchema.safeParse(patch);

    if (!parsed.success) {
      const fieldErrors = toFieldErrors<"name" | "timezone">(parsed.error);
      setErrors({ name: fieldErrors.name, form: fieldErrors.form });
      return;
    }

    setErrors({});
    setPending(true);
    setSaved(false);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const updated = await api.workspace.update(parsed.data, {
        signal: controller.signal,
      });
      const next = toDraft(updated, environments);

      setDraft(next);
      setBaseline(next);
      setDefaultEnvironmentId(updated.defaultEnvironmentId);
      setSaved(true);
      router.refresh();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setErrors({
        form:
          caught instanceof api.ApiError
            ? caught.message
            : "The workspace could not be saved. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard
      title="Workspace profile"
      description="This information appears across the dashboard and in audit exports."
      footer={
        <div className="flex items-center justify-between gap-3">
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
            type="button"
            size="sm"
            className="gap-1.5 text-[11px]"
            disabled={pending || !dirty}
            onClick={handleSave}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field
          id="workspace-name"
          label="Workspace name"
          name="name"
          placeholder="Acme Inc"
          required
          maxLength={60}
          value={draft.name}
          error={errors.name}
          onChange={(event) => update({ name: event.target.value })}
        />

        <div className="space-y-2">
          <Label htmlFor="workspace-url">Workspace URL</Label>
          <Input
            id="workspace-url"
            value={workspaceUrl(profile.slug)}
            readOnly
            disabled
            title="The workspace URL is fixed once the workspace exists."
            className="font-mono text-[12px]"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="workspace-environment">Default environment</Label>
            <Select
              value={draft.defaultEnvironmentKey ?? ""}
              onValueChange={(value) =>
                update({ defaultEnvironmentKey: value })
              }
              disabled={environments.length === 0}
            >
              <SelectTrigger
                id="workspace-environment"
                className="h-8 w-full text-[12px]"
              >
                <SelectValue placeholder="No default environment" />
              </SelectTrigger>
              <SelectContent>
                {environments.map((environment) => (
                  <SelectItem key={environment.id} value={environment.key}>
                    {environment.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="workspace-timezone">Timezone</Label>
            <Select
              value={draft.timezone}
              onValueChange={(value) => update({ timezone: value })}
            >
              <SelectTrigger
                id="workspace-timezone"
                className="h-8 w-full text-[12px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {timezoneChoices(draft.timezone).map((timezone) => (
                  <SelectItem key={timezone} value={timezone}>
                    {timezone}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {unresolvedDefault ? (
          <p className="text-muted-foreground text-[11px]">
            The workspace default environment is not in the project selected in
            the sidebar.
          </p>
        ) : null}

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}
      </div>
    </SettingsCard>
  );
}
