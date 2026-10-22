"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon } from "lucide-react";
import {
  toFieldErrors,
  updateNotificationsSchema,
  updatePreferencesSchema,
  type EnvironmentSummary,
  type Theme,
  type UpdateNotificationsInput,
  type UserPreferences,
} from "@iwifunni/contracts";
import { SettingsCard, SettingsRowLabel } from "@/components/app/settings-card";
import { ThemeChoice } from "@/components/app/theme-choice";
import { FieldError } from "@/components/auth/field";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";
import { useTheme } from "@/components/app/personal-theme";

const SAVED_HINT_MS = 2_000;

const notificationRows: Array<{
  key: keyof UpdateNotificationsInput;
  label: string;
  description: string;
}> = [
  {
    key: "flagChanges",
    label: "Flag changes",
    description: "Approval decisions and project lifecycle updates in the inbox.",
  },
  {
    key: "weeklyDigest",
    label: "Weekly digest",
    description: "Email digests are not available yet.",
  },
  {
    key: "incidentAlerts",
    label: "Incident alerts",
    description: "Failed schedules and automatic rollbacks in the inbox.",
  },
];

function environmentKeyOf(
  defaultEnvironmentId: string | null,
  environments: EnvironmentSummary[],
): string | null {
  if (!defaultEnvironmentId) return null;

  return (
    environments.find((environment) => environment.id === defaultEnvironmentId)
      ?.key ?? null
  );
}

function useSavedHint() {
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  function acknowledge() {
    setSaved(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setSaved(false), SAVED_HINT_MS);
  }

  function reset() {
    setSaved(false);
  }

  return { saved, acknowledge, reset };
}

function SavedHint({ saved }: { readonly saved: boolean }) {
  if (!saved) return null;

  return (
    <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
      <CheckIcon aria-hidden="true" className="size-3.5" />
      Saved just now
    </span>
  );
}

export function ProfilePreferences({
  environments,
  preferences,
}: {
  readonly environments: EnvironmentSummary[];
  readonly preferences: UserPreferences;
}) {
  const [current, setCurrent] = useState<{
    theme: Theme;
    defaultEnvironmentKey: string | null;
  }>({ theme: preferences.theme, defaultEnvironmentKey: environmentKeyOf(preferences.defaultEnvironmentId, environments) });
  const { setTheme } = useTheme();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { saved, acknowledge, reset } = useSavedHint();
  const controllerRef = useRef<AbortController | null>(null);

  async function apply(
    patch: Partial<{ theme: Theme; defaultEnvironmentKey: string | null }>,
  ) {
    if (pending) return;
    const previous = current;
    const next = { ...current, ...patch };

    setCurrent(next);
    reset();
    setError(null);

    const parsed = updatePreferencesSchema.safeParse(next);

    if (!parsed.success) {
      setCurrent(previous);
      const fieldErrors = toFieldErrors(parsed.error);
      setError(
        fieldErrors.form ??
          Object.values(fieldErrors)[0] ??
          "That preference is not valid.",
      );
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      setPending(true);
      const updated = await api.me.updatePreferences(parsed.data, {
        signal: controller.signal,
      });

      setCurrent({
        theme: updated.theme,
        defaultEnvironmentKey: environmentKeyOf(
          updated.defaultEnvironmentId,
          environments,
        ),
      });
      setTheme(updated.theme);
      acknowledge();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setCurrent(previous);
      setError(
        caught instanceof api.ApiError
          ? caught.message
          : "That preference could not be saved. Please try again.",
      );
    } finally { setPending(false); }
  }

  return (
    <SettingsCard title="Preferences" action={<SavedHint saved={saved} />}>


      <div className="mt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] font-medium">Theme</p>
          <ThemeChoice theme={current.theme} disabled={pending} onChange={(theme) => apply({ theme })} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="profile-environment">Default environment</Label>
          <Select
            value={current.defaultEnvironmentKey ?? "project-default"}
            onValueChange={(value) => apply({ defaultEnvironmentKey: value === "project-default" ? null : value })}
            disabled={pending || environments.length === 0}
          >
            <SelectTrigger
              id="profile-environment"
              className="h-8 w-full text-[12px]"
            >
              <SelectValue placeholder="No default environment" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="project-default">Use project default</SelectItem>
              {environments.map((environment) => (
                <SelectItem key={environment.id} value={environment.key}>
                  {environment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? <FieldError>{error}</FieldError> : null}
      </div>
    </SettingsCard>
  );
}

export function ProfileNotifications({ preferences }: { readonly preferences: UserPreferences }) {
  const [pending, setPending] = useState(false);
  const [current, setCurrent] =
    useState<UpdateNotificationsInput>(preferences.notifications);
  const [error, setError] = useState<string | null>(null);
  const { saved, acknowledge, reset } = useSavedHint();
  const controllerRef = useRef<AbortController | null>(null);

  async function apply(next: UpdateNotificationsInput) {
    if (pending) return;
    const previous = current;

    setCurrent(next);
    reset();
    setError(null);

    const parsed = updateNotificationsSchema.safeParse(next);

    if (!parsed.success) {
      setCurrent(previous);
      const fieldErrors = toFieldErrors(parsed.error);
      setError(
        fieldErrors.form ??
          Object.values(fieldErrors)[0] ??
          "That notification choice is not valid.",
      );
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      setPending(true);
      const updated = await api.me.updateNotifications(parsed.data, {
        signal: controller.signal,
      });

      setCurrent(updated.notifications);
      acknowledge();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setCurrent(previous);
      setError(
        caught instanceof api.ApiError
          ? caught.message
          : "That notification choice could not be saved. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard title="Notifications" action={<SavedHint saved={saved} />}>
      <p className="text-muted-foreground text-[11px]">
        Choose which updates appear in your notification inbox. Email delivery and weekly digests are not available yet.
      </p>

      <ul className="mt-3 divide-y">
        {notificationRows.map((row) => (
          <li
            key={row.key}
            className="flex items-start justify-between gap-4 py-3 first:pt-0 last:pb-0"
          >
            <SettingsRowLabel label={row.label} description={row.description} />
            <Switch
              disabled={pending || row.key === "weeklyDigest"}
              checked={current[row.key]}
              onCheckedChange={(value) =>
                apply({ ...current, [row.key]: value })
              }
              aria-label={row.label}
              className="mt-0.5 shrink-0"
            />
          </li>
        ))}
      </ul>

      {error ? (
        <div className="mt-3">
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </SettingsCard>
  );
}
