"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheckIcon,
  HistoryIcon,
  LoaderCircleIcon,
  SaveIcon,
} from "lucide-react";
import type { FlagDetail, FlagEnvironmentConfig } from "@iwifunni/contracts";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ApiError, changeRequests as changeRequestsApi, flags as flagsApi } from "@/lib/api";
import { capture } from "@/shared/analytics";

/**
 * Configuration tab.
 *
 * What one flag does in one environment: whether it is served, what it serves
 * by default and while off, how far it has rolled out, and the attribute it
 * buckets by. The values themselves belong to the flag, not the environment, so
 * they are edited on the Variations tab. The read-only panels (metadata, danger
 * zone) are passed in from the server page as children and stay Server
 * Components.
 */
export function FlagConfiguration({
  projectKey,
  flagKey,
  flag,
  config,
  updatedLabel,
  metadata,
  dangerZone,
  approval,
  protectedEnvironment,
}: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly flag: FlagDetail;
  /** The flag's configuration in the environment this screen is scoped to. */
  readonly config: FlagEnvironmentConfig;
  readonly updatedLabel: string;
  readonly metadata: React.ReactNode;
  readonly dangerZone: React.ReactNode;
  /** Approval state for this flag in this environment. */
  readonly approval: React.ReactNode;
  readonly protectedEnvironment: boolean;
}) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [offVariation, setOffVariation] = useState(config.offVariation);
  const [serving, setServing] = useState(config.defaultVariation);
  const [percentage, setPercentage] = useState(config.rolloutPercentage);
  const [pending, setPending] = useState(false);
  const [published, setPublished] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  const archived = flag.status === "archived";
  const environmentLabel = config.environmentName;
  const servingName =
    flag.variations.find((variation) => variation.key === serving)?.name ??
    serving;

  async function handlePublish() {
    if (archived || pending) return;
    setPending(true);
    setPublished(null);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    const input = {
      enabled,
      offVariation,
      defaultVariation: serving,
      rolloutPercentage: percentage,
      bucketBy: config.bucketBy,
    };

    try {
      // A protected environment refuses the direct publish, so this is where
      // the change becomes a proposal instead of taking effect.
      if (protectedEnvironment) {
        await changeRequestsApi.create(
          projectKey,
          flagKey,
          {
            environmentKey: config.environmentKey,
            payload: { config: input },
          },
          { signal: controller.signal },
        );

        capture("feature_flag_configuration_published", {
          publish_mode: "submitted_for_approval",
          enabled,
          rollout_percentage: percentage,
        });

        setPublished(null);
        setSubmitted(true);
        router.refresh();
        return;
      }

      const updated = await flagsApi.updateEnvironmentConfig(
        projectKey,
        flagKey,
        config.environmentKey,
        input,
        { signal: controller.signal },
      );

      setEnabled(updated.enabled);
      setOffVariation(updated.offVariation);
      setServing(updated.defaultVariation);
      setPercentage(updated.rolloutPercentage);
      capture("feature_flag_configuration_published", {
        publish_mode: "published",
        enabled: updated.enabled,
        rollout_percentage: updated.rolloutPercentage,
      });
      setPublished("just now");
      // The identity strip above the tabs is a Server Component, so its
      // Enabled/Disabled badge only moves when the server data is re-read.
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
      <div className="space-y-4">
        {archived ? (
          <p className="text-muted-foreground rounded-lg border bg-muted/50 px-3 py-2 text-[11px] leading-4">
            This flag is archived. Every environment serves its off variation, so
            this configuration cannot be changed. Restore the flag to edit it.
          </p>
        ) : null}

        {approval}

        <section className="bg-card rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[13px] font-medium capitalize">
                {environmentLabel}
              </h2>
              <p className="text-muted-foreground mt-1 text-[11px]">
                Serve this flag in {environmentLabel.toLowerCase()}.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              aria-label={`Serve ${flagKey} in ${environmentLabel}`}
              disabled={archived}
            />
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="flag-serving">Default value</Label>
            <Select
              value={serving}
              onValueChange={setServing}
              disabled={archived}
            >
              <SelectTrigger
                id="flag-serving"
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
            <p className="text-muted-foreground text-[11px]">
              Returned when the flag is on and no targeting rule selects
              something else. A rollout passes over it at or above its
              threshold.
            </p>
          </div>

          <div className="mt-4 space-y-2">
            <Label htmlFor="flag-off-variation">Off value</Label>
            <Select
              value={offVariation}
              onValueChange={setOffVariation}
              disabled={archived}
            >
              <SelectTrigger
                id="flag-off-variation"
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
            <p className="text-muted-foreground text-[11px]">
              Returned while the flag is off in {environmentLabel}, to subjects a
              rollout passes over, and when the SDK cannot reach Iwifunni.
            </p>
          </div>
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Percentage Rollout</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Send a share of users the default value and everyone else the off
            value. Below the percentage gets the default, at or above it gets the
            off value, so 0% serves nobody and 100% serves everybody.
          </p>

          <div className="mt-5">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={percentage}
              aria-label={`${flagKey} rollout percentage`}
              disabled={archived}
              onChange={(event) => setPercentage(Number(event.target.value))}
              className="accent-primary bg-muted h-1.5 w-full cursor-pointer rounded-full"
            />
            <div className="text-muted-foreground mt-1 flex items-center justify-between text-[10px]">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          <div className="bg-muted/50 mt-4 rounded-lg border p-3">
            <div className="flex items-end justify-between gap-4">
              <p className="text-[28px] leading-none font-semibold tracking-tight">
                {percentage}%
              </p>
              <p className="text-muted-foreground text-right text-[11px]">
                of users in {environmentLabel} will receive the default value
                &quot;{servingName}&quot;
              </p>
            </div>
            <div className="text-muted-foreground mt-3 flex items-center justify-between gap-4 text-[11px]">
              <span>
                {percentage === 0
                  ? "Off — nobody receives this variation"
                  : "Deterministic bucketing keeps each user's result stable"}
              </span>
              <span className="font-mono">bucket-by: {config.bucketBy}</span>
            </div>
          </div>

          {error ? <FieldError>{error}</FieldError> : null}

          <div className="mt-4 flex items-center justify-between gap-3">
            {published ? (
              <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
                <CheckCheckIcon aria-hidden="true" className="size-3.5" />
                Last published {published}
              </span>
            ) : submitted ? (
              <span className="text-info-ink inline-flex items-center gap-1.5 text-[11px]">
                <HistoryIcon aria-hidden="true" className="size-3.5" />
                Submitted for approval
              </span>
            ) : (
              <span className="text-muted-foreground inline-flex items-center gap-1.5 text-[11px]">
                <HistoryIcon aria-hidden="true" className="size-3.5" />
                Last published {updatedLabel}
              </span>
            )}

            <Button
              size="sm"
              className="gap-1.5 text-[11px]"
              disabled={archived || pending}
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
                  : "Publish changes"}
            </Button>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        {metadata}
        {dangerZone}
      </div>
    </div>
  );
}
