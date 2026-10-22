"use client";

import { useState } from "react";
import { cn } from "cn";
import { SdkResourcesCard } from "@/components/app/sdks/sdk-resources-card";
import { sdkIcons } from "@/components/app/sdks/sdk-icons";
import { CopyButton } from "@/components/app/copy-button";
import { SectionCard } from "@/components/app/page-header";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { defaultSdkKey, getSdkOptions, type SdkKey } from "@/lib/sdk-data";

/** Connection values the screen quotes, resolved from the environment. */
export interface SdkConnection {
  readonly environmentKey: string;
  /** Environment the values belong to, e.g. `Production`. */
  environmentName: string;
  /** The API returns `null` until an SDK key has been issued. */
  maskedKey: string | null;
  /** The endpoint an SDK fetches its snapshot from, e.g. `…/v1/sdk/config`. */
  endpoint: string;
  streamEndpoint: string | null;
}

export function SdkIntegration({
  connection,
}: {
  readonly connection: SdkConnection;
}) {
  const [selected, setSelected] = useState<SdkKey>(defaultSdkKey);
  const options = getSdkOptions();
  const sdk = options.find((option) => option.key === selected) ?? options[0];

  const steps: Array<{ title: string; code: string }> = [
    { title: "Install", code: sdk.steps.install },
    { title: "Initialize", code: sdk.steps.initialize.replace('  sdkKey: process.env.IWIFUNNI_SDK_KEY,', `  sdkKey: process.env.IWIFUNNI_SDK_KEY,\n  baseUrl: ${JSON.stringify(connection.endpoint.replace(/\/v1\/sdk\/config$/, ""))},`).replace('environment: "production"', `environment: ${JSON.stringify(connection.environmentKey)}`) },
    { title: "Evaluate a flag", code: sdk.steps.evaluate },
  ];

  const connectionRows: Array<{
    label: string;
    value: string | null;
    mono: boolean;
  }> = [
    { label: "SDK key", value: connection.maskedKey, mono: true },
    { label: "SDK endpoint", value: connection.endpoint, mono: true },
    {
      label: "Streaming endpoint",
      value: connection.streamEndpoint,
      mono: true,
    },
    { label: "Evaluation scope", value: sdk.scope, mono: false },
  ];

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.45fr)]">
      <div className="space-y-3">
        <SectionCard title="Choose your SDK">
          <p className="mb-3 text-xs text-muted-foreground">Node.js is available from this workspace. Additional SDKs are not released yet.</p>
          <RadioGroup
            value={selected}
            onValueChange={(value) => setSelected(value as SdkKey)}
            aria-label="Choose your SDK"
            className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          >
            {options.map((option) => {
              const Icon = sdkIcons[option.key];
              const active = option.key === selected;

              return (
                <Label
                  key={option.key}
                  htmlFor={`sdk-${option.key}`}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 font-normal transition-colors",
                    active
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50",
                  )}
                >
                  <RadioGroupItem
                    id={`sdk-${option.key}`}
                    value={option.key}
                    className="sr-only"
                  />
                  <Icon
                    aria-hidden="true"
                    className={cn(
                      "size-3.5 shrink-0",
                      active ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="truncate text-[12px] font-medium">
                    {option.label}
                  </span>
                </Label>
              );
            })}
          </RadioGroup>

          <p className="text-muted-foreground mt-3 text-[11px] leading-5">
            All SDKs share the same flag definitions and evaluation rules.
          </p>
        </SectionCard>

        {steps.map((step, index) => (
          <section key={step.title} className="bg-card rounded-lg border p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-[12px] font-medium">
                {index + 1}: {step.title}
              </h3>
              <CopyButton
                value={step.code}
                label={`${sdk.label} ${step.title.toLowerCase()} snippet`}
                labelled
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
              />
            </div>

            <pre className="bg-nav-bg mt-2.5 overflow-x-auto rounded-lg p-3 font-mono text-[11px] leading-5 text-white/90">
              <code>{step.code}</code>
            </pre>
          </section>
        ))}
      </div>

      <div className="space-y-3">
        <SectionCard title="Connection">
          <dl className="space-y-3">
            {connectionRows.map((row) => (
              <div key={row.label}>
                <dt className="text-muted-foreground text-[11px]">
                  {row.label}
                </dt>
                <dd className="bg-muted mt-1.5 flex items-center justify-between gap-2 rounded-lg px-3 py-2">
                  <span
                    className={cn(
                      "truncate text-[12px]",
                      row.mono && "font-mono",
                      row.value === null && "text-muted-foreground italic",
                    )}
                  >
                    {row.value ?? "Not available yet"}
                  </span>
                  {row.value === null ? null : (
                    <CopyButton
                      value={row.value}
                      label={`${connection.environmentName} ${row.label.toLowerCase()}`}
                      className="shrink-0"
                    />
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </SectionCard>

        <SdkResourcesCard />
      </div>
    </div>
  );
}
