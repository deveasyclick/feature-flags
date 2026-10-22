"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, PlusIcon } from "lucide-react";
import {
  toFieldErrors,
  updateWorkspaceSecuritySchema,
  type WorkspaceSecuritySettings,
} from "@iwifunni/contracts";
import { SettingsCard, SettingsRowLabel } from "@/components/app/settings-card";
import {
  auditRetentionOptions,
  sessionTimeoutOptions,
} from "@/components/app/settings/settings-options";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import * as api from "@/lib/api";

const SAVED_HINT_MS = 2_000;

function retentionChoices(current: number): Array<{ value: number; label: string }> {
  return auditRetentionOptions.some((option) => option.value === current)
    ? auditRetentionOptions
    : [{ value: current, label: `${current} days` }, ...auditRetentionOptions];
}

export function SettingsSecurity({
  settings,
}: {
  readonly settings: WorkspaceSecuritySettings;
}) {
  const [current, setCurrent] = useState<WorkspaceSecuritySettings>(settings);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  async function apply(patch: Partial<WorkspaceSecuritySettings>) {
    const previous = current;
    const next = { ...current, ...patch };

    setCurrent(next);
    setSaved(false);
    setError(null);

    const parsed = updateWorkspaceSecuritySchema.safeParse(next);

    if (!parsed.success) {
      setCurrent(previous);
      const fieldErrors = toFieldErrors(parsed.error);
      setError(
        fieldErrors.form ??
          Object.values(fieldErrors)[0] ??
          "Those security settings are not valid.",
      );
      return;
    }

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const updated = await api.workspace.updateSecurity(parsed.data, {
        signal: controller.signal,
      });

      setCurrent(updated);
      setSaved(true);
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(
        () => setSaved(false),
        SAVED_HINT_MS,
      );
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setCurrent(previous);
      setError(
        caught instanceof api.ApiError
          ? caught.message
          : "The security settings could not be saved. Please try again.",
      );
    }
  }

  const status = error ? (
    <span className="text-danger-ink text-[11px]">{error}</span>
  ) : saved ? (
    <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
      <CheckIcon aria-hidden="true" className="size-3.5" />
      Saved just now
    </span>
  ) : null;

  return (
    <div className="space-y-3">
      <SettingsCard
        title="Authentication"
        description="Control how members sign in and stay authenticated."
        action={status}
      >
        <ul className="divide-y">
          <li className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <SettingsRowLabel
              label="Single sign-on (SAML)"
              description="Authenticate through your identity provider."
            />

            <div className="flex shrink-0 items-center gap-2">
              {current.ssoConnected ? (
                <Badge variant="ok" className="gap-1.5">
                  <span
                    aria-hidden="true"
                    className="bg-ok-ink size-1.5 rounded-full"
                  />
                  {current.ssoProvider
                    ? `${current.ssoProvider} · Connected`
                    : "Connected"}
                </Badge>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Managing single sign-on — coming soon"
                className="text-[11px]"
              >
                Manage
              </Button>
            </div>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
            <SettingsRowLabel
              label="Two-factor authentication"
                description="Require every member to enroll before accessing workspace data. Enroll your own account first."
            />
            <Switch
                checked={current.twoFactorEnabled}
              onCheckedChange={(value) => apply({ twoFactorEnabled: value })}
              aria-label="Require two-factor authentication"
              className="shrink-0"
            />
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <SettingsRowLabel
              label="Maximum session age"
              description="Expire sessions after this duration from sign-in."
            />
            <Select
              value={current.sessionTimeout}
              onValueChange={(value) =>
                apply({
                  sessionTimeout:
                    value as WorkspaceSecuritySettings["sessionTimeout"],
                })
              }
            >
              <SelectTrigger
                aria-label="Maximum session age"
                className="h-8 w-28 shrink-0 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sessionTimeoutOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        </ul>
      </SettingsCard>

      <SettingsCard
        title="Access control"
        description="Restrict who can reach the workspace and how long activity is retained."
        action={status}
      >
        <ul className="divide-y">
          <li className="flex flex-wrap items-center justify-between gap-3 pb-3">
            <SettingsRowLabel
              label="Allowed email domains"
              description="Only these domains can be invited to the workspace."
            />

            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {current.allowedEmailDomains.length === 0 ? (
                <span className="text-muted-foreground font-mono text-[11px]">
                  None
                </span>
              ) : (
                current.allowedEmailDomains.map((domain) => (
                  <span
                    key={domain}
                    className="bg-muted text-muted-foreground rounded-md px-2.5 py-1.5 font-mono text-[11px]"
                  >
                    {domain}
                  </span>
                ))
              )}
              <Button
                variant="outline"
                size="sm"
                disabled
                title="Adding a domain — coming soon"
                className="gap-1.5 text-[11px]"
              >
                <PlusIcon aria-hidden="true" className="size-3.5" />
                Add
              </Button>
            </div>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 py-3">
            <SettingsRowLabel
              label="IP allowlist"
              description="Restrict dashboard access to trusted networks."
            />
            <Button
              variant="outline"
              size="sm"
              disabled
              title="Configuring an IP allowlist — coming soon"
              className="shrink-0 text-[11px]"
            >
              Configure
            </Button>
          </li>

          <li className="flex flex-wrap items-center justify-between gap-3 pt-3">
            <SettingsRowLabel
              label="Audit log retention"
              description="Audit records expire after 90 days. Other retention periods are not available yet."
            />
            <Select
              disabled
              value={String(current.auditRetentionDays)}
              onValueChange={(value) =>
                apply({ auditRetentionDays: Number(value) })
              }
            >
              <SelectTrigger
                aria-label="Audit log retention"
                className="h-8 w-28 shrink-0 text-[11px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {retentionChoices(current.auditRetentionDays).map((option) => (
                  <SelectItem key={option.value} value={String(option.value)}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </li>
        </ul>
      </SettingsCard>
    </div>
  );
}
