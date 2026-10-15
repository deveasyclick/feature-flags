import Link from "next/link";
import {
  ArrowRightIcon,
  GlobeIcon,
  KeyRoundIcon,
  LockIcon,
  RadioIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from "lucide-react";
import { cn } from "cn";
import type {
  EnvironmentConnection,
  EnvironmentDetail,
  EnvironmentSummary,
} from "@iwifunni/contracts";
import {
  environmentColorSwatch,
  environmentColors,
} from "@/components/app/environments/environment-colors";
import {
  countLabel,
  type EnvironmentFlagCounts,
} from "@/components/app/environments/capped-count";
import { MaskedKeyChip } from "@/components/app/environments/environment-keys";
import { EnvironmentMenu } from "@/components/app/environments/environment-menu";
import { Badge } from "@/components/ui/badge";
import { resolveEnvironmentColor } from "@/lib/environment-color";
import { formatDate } from "@/lib/format";

/**
 * Read-only environment panels.
 *
 * Deliberately free of `"use client"` so they stay Server Components; the few
 * genuinely interactive pieces (the key chip, the actions menu) are imported
 * client components.
 */

/** Default, protected and archived markers, all sourced from the environment. */
export function EnvironmentBadges({
  isDefault,
  isProtected,
  isArchived,
}: {
  readonly isDefault: boolean;
  readonly isProtected: boolean;
  readonly isArchived: boolean;
}) {
  if (!isDefault && !isProtected && !isArchived) return null;

  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {isArchived ? (
        <Badge variant="secondary" className="text-[10px] tracking-wide uppercase">
          Archived
        </Badge>
      ) : null}
      {isDefault ? (
        <Badge
          variant="outline"
          className="text-[10px] tracking-wide uppercase"
        >
          Default
        </Badge>
      ) : null}
      {isProtected ? (
        <Badge variant="secondary" className="text-[10px]">
          Protected
        </Badge>
      ) : null}
    </span>
  );
}

/** Flag totals as three tiles — the unit both the cards and project tables use. */
function CountTiles({
  counts,
  dense = false,
}: {
  readonly counts: EnvironmentFlagCounts;
  readonly dense?: boolean;
}) {
  const tiles: Array<{ label: string; value: string; tone: string }> = [
    { label: "On", value: countLabel(counts.on), tone: "bg-ok-ink/10 text-ok-ink" },
    {
      label: "Partial",
      value: countLabel(counts.partial),
      tone: "bg-info-ink/10 text-info-ink",
    },
    {
      label: "Off",
      value: countLabel(counts.off),
      tone: "bg-muted text-foreground",
    },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className={cn("rounded-md px-2 text-center", tile.tone)}
        >
          <p
            className={cn(
              "font-semibold",
              dense ? "pt-1.5 text-[14px]" : "pt-2.5 text-[17px] leading-6",
            )}
          >
            {tile.value}
          </p>
          <p className="pb-1.5 text-[10px] opacity-80">{tile.label}</p>
        </div>
      ))}
    </div>
  );
}

/**
 * One environment as the list screen renders it: the summary the list returns,
 * the connection the detail read adds, and the flag counts derived from one
 * capped page of flags.
 */
export interface EnvironmentCardData {
  environment: EnvironmentSummary;
  connection: EnvironmentConnection;
  counts: EnvironmentFlagCounts;
}

/** One environment as summarised on the Environments list. */
export function EnvironmentCard({ data }: { readonly data: EnvironmentCardData }) {
  const { environment, connection, counts } = data;

  return (
    <article
      className={cn(
        "bg-card flex flex-col rounded-lg border p-4",
        environment.isDefault && "border-primary",
      )}
    >
      <div className="flex items-center gap-2">
        <h2 className="text-[13px] font-medium">{environment.name}</h2>
        <span className="ml-auto flex items-center gap-1">
          <EnvironmentBadges
            isDefault={environment.isDefault}
            isProtected={environment.isProtected}
            isArchived={environment.archivedAt !== null}
          />
          <EnvironmentMenu environment={environment} />
        </span>
      </div>

      <div className="mt-3">
        <MaskedKeyChip
          value={connection.maskedKey}
          label={`${environment.name} key`}
        />
      </div>

      <p className="text-muted-foreground mt-3 truncate font-mono text-[11px]">
        {connection.baseUrl}
      </p>

      <div className="mt-3">
        <CountTiles counts={counts} dense />
      </div>

      <Link
        href={`/environments/${environment.key}`}
        className="text-muted-foreground hover:text-foreground mt-4 flex items-center justify-between gap-2 border-t pt-3 text-[12px] transition-colors"
      >
        Manage environment
        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
      </Link>
    </article>
  );
}

/** The environment cards, with the empty state the design does not cover. */
export function EnvironmentGrid({
  environments,
}: {
  readonly environments: EnvironmentCardData[];
}) {
  if (environments.length === 0) {
    return (
      <section className="bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-[13px]">
        No environments yet. Create one to give your flags an isolated
        configuration.
      </section>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {environments.map((environment) => (
        <EnvironmentCard
          key={environment.environment.key}
          data={environment}
        />
      ))}
    </div>
  );
}

/** Explains an archived environment on the tabs that cannot restore it. */
export function ArchivedEnvironmentNotice({ name }: { readonly name: string }) {
  return (
    <aside className="bg-muted text-muted-foreground mb-4 rounded-lg border p-3 text-[12px]">
      {name} is archived. Its SDK keys are revoked and it no longer appears in
      the switcher. Restore it from the Settings tab to make changes.
    </aside>
  );
}

/** Read-only facts about an environment, as shown on the Settings tab. */
export function EnvironmentMetadataCard({
  environment,
}: {
  readonly environment: EnvironmentDetail;
}) {
  const color = resolveEnvironmentColor(environment.color);
  const colorLabel =
    environmentColors.find((option) => option.value === color)?.label ?? color;

  const rows: Array<[string, React.ReactNode]> = [
    ["Key", <span key="key" className="font-mono">{environment.key}</span>],
    [
      "Description",
      environment.description ?? (
        <span key="description" className="text-muted-foreground">
          None
        </span>
      ),
    ],
    [
      "Evaluation endpoint",
      <span key="endpoint" className="font-mono">
        {environment.connection.evalUrl}
      </span>,
    ],
    [
      "Colour",
      <span key="colour" className="inline-flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={cn("size-2.5 rounded-full", environmentColorSwatch[color])}
        />
        {colorLabel}
      </span>,
    ],
    ["Created", formatDate(environment.createdAt)],
    ["Updated", formatDate(environment.updatedAt)],
    ["Status", environment.archivedAt ? "Archived" : "Active"],
    ["Default", environment.isDefault ? "Yes" : "No"],
    ["Protected", environment.isProtected ? "Yes" : "No"],
  ];

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">Metadata</h2>
      <dl className="mt-3 divide-y text-[12px]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0"
          >
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

const whatYouGet: Array<{
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
}> = [
  {
    title: "SDK keys",
    description: "Scoped keys for server and client SDKs",
    icon: KeyRoundIcon,
    tone: "bg-primary/10 text-primary",
  },
  {
    title: "SDK endpoints",
    description: "Per-environment evaluation URLs",
    icon: GlobeIcon,
    tone: "bg-info-ink/10 text-info-ink",
  },
  {
    title: "Streaming",
    description: "Live updates over SSE",
    icon: RadioIcon,
    tone: "bg-purple-ink/10 text-purple-ink",
  },
  {
    title: "Isolated config",
    description: "Changes never affect other environments",
    icon: LockIcon,
    tone: "bg-ok-ink/10 text-ok-ink",
  },
];

/** Side panel on the create screen listing what a new environment comes with. */
export function WhatYouGetCard() {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">What you get</h2>

      <ul className="mt-3 space-y-3">
        {whatYouGet.map((item) => {
          const Icon = item.icon;

          return (
            <li key={item.title} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  item.tone,
                )}
              >
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12px] font-medium">
                  {item.title}
                </span>
                <span className="text-muted-foreground block text-[11px]">
                  {item.description}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function ProtectedEnvironmentsNote() {
  return (
    <aside className="border-info-ink/20 bg-info-ink/5 rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span className="bg-info-ink/10 text-info-ink flex size-6 shrink-0 items-center justify-center rounded-md">
          <ShieldCheckIcon aria-hidden="true" className="size-3.5" />
        </span>
        <h2 className="text-info-ink text-[12px] font-medium">
          Protected environments
        </h2>
      </div>
      <p className="text-muted-foreground mt-2 text-[11px] leading-5">
        A protected environment refuses direct flag changes. An engineer
        proposes the change, and a project admin other than the author approves
        it before it reaches the environment.
      </p>
    </aside>
  );
}
