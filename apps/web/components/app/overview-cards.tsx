import Link from "next/link";
import { cn } from "cn";
import { auditActionMeta } from "@/components/app/audit-log/audit-action-meta";
import { sectionActionClass, SectionCard } from "@/components/app/page-header";
import { ProgressBar } from "@/components/app/progress-bar";
import type { AuditAction } from "@iwifunni/contracts";

export interface ActiveRollout {
  flagKey: string;
  environment: string;
  percentage: number;
}

/** A flag's on/off split in one environment, as the health panel shows it. */
export interface FlagHealth {
  environment: string;
  enabled: number;
  disabled: number;
}

export interface RecentActivity {
  id: string;
  action: AuditAction;
  title: string;
  description: string;
  ageLabel: string;
}

export function ActiveRolloutsCard({
  rollouts,
}: {
  readonly rollouts: ActiveRollout[];
}) {
  return (
    <SectionCard
      title="Active Rollouts"
      action={
        <Link href="/flags" className={sectionActionClass}>
          View all
        </Link>
      }
    >
      {rollouts.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          No rollouts in progress.
        </p>
      ) : (
        <ul className="space-y-4">
          {rollouts.map((rollout) => (
            <li key={`${rollout.flagKey}-${rollout.environment}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-[12px]">
                    {rollout.flagKey}
                  </span>
                  <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-[10px]">
                    {rollout.environment}
                  </span>
                </span>
                <span className="text-muted-foreground shrink-0 text-[11px]">
                  {rollout.percentage}%
                </span>
              </div>
              <div className="mt-2">
                <ProgressBar
                  value={rollout.percentage}
                  className="bg-primary"
                  label={`${rollout.flagKey} rollout`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

export function FlagHealthCard({ health }: { readonly health: FlagHealth[] }) {
  return (
    <SectionCard
      title="Flag Health"
      action={
        <Link href="/environments" className={sectionActionClass}>
          Details
        </Link>
      }
    >
      {health.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          No environments yet.
        </p>
      ) : (
        <ul className="space-y-4">
          {health.map((entry) => {
            const total = entry.enabled + entry.disabled;
            const percentage =
              total === 0 ? 0 : Math.round((entry.enabled / total) * 100);

            return (
              <li key={entry.environment}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[12px]">{entry.environment}</span>
                  <span className="text-muted-foreground text-[11px]">
                    {entry.enabled} on · {entry.disabled} off
                  </span>
                </div>
                <div className="mt-2">
                  <ProgressBar
                    value={percentage}
                    className="bg-success"
                    label={`${entry.environment} flag health`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

export function RecentActivityCard({
  activity,
}: {
  readonly activity: RecentActivity[];
}) {
  return (
    <SectionCard
      title="Recent Activity"
      action={
        <Link href="/audit-log" className={sectionActionClass}>
          View all
        </Link>
      }
    >
      {activity.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          No changes in the last 7 days.
        </p>
      ) : (
        <ul className="divide-y">
          {activity.map((entry) => {
            const { icon: Icon, tone } = auditActionMeta[entry.action];

            return (
              <li
                key={entry.id}
                className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md",
                    tone,
                  )}
                >
                  <Icon aria-hidden="true" className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[12px]">
                    {entry.title}
                  </p>
                  <p className="text-muted-foreground truncate text-[11px]">
                    {entry.description}
                  </p>
                </div>
                <span className="text-muted-foreground shrink-0 text-[10px]">
                  {entry.ageLabel}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}
