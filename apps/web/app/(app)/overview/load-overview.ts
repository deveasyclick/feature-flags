import type { FlagSummary } from "@dariise/contracts";
import { auditActionMeta } from "@/components/app/audit-log/audit-action-meta";
import { listProjectFlags } from "@/components/app/flags/flag-queries";
import type {
  ActiveRollout,
  FlagHealth,
  RecentActivity,
} from "@/components/app/overview-cards";
import type { HeroStat } from "@/components/app/stat-card";
import * as api from "@/lib/api";
import { formatInteger, formatRelativeTime } from "@/lib/format";
import { getScope } from "@/lib/scope";

const ACTIVITY_WINDOW_HOURS = 24 * 7;
const ACTIVITY_LIMIT = 6;
const HOUR_MS = 60 * 60 * 1000;

export interface OverviewData {
  stats: HeroStat[];
  activeRollouts: ActiveRollout[];
  flagHealth: FlagHealth[];
  recentActivity: RecentActivity[];
}

/** How one flag stands in one environment, from the summary it carries. */
function stateIn(flag: FlagSummary, environmentKey: string) {
  return flag.environments.find(
    (environment) => environment.environmentKey === environmentKey,
  );
}

/**
 * Whether a flag is serving anybody in one environment.
 *
 * A rollout of 0% is a threshold that sends every subject to the off variation,
 * so a flag sitting there is off even though its switch reads as on. This is the
 * same reading the environments screen counts with, and the same one the flag
 * list renders, so the two cannot report different totals for one environment.
 */
function isServing(state: {
  enabled: boolean;
  rolloutPercentage: number;
}): boolean {
  return state.enabled && state.rolloutPercentage > 0;
}

function isRollingOut(state: {
  enabled: boolean;
  rolloutPercentage: number;
}): boolean {
  return isServing(state) && state.rolloutPercentage <= 99;
}

export async function loadOverview(now: Date): Promise<OverviewData | null> {
  const { project, environments, environment } = await getScope();

  if (!project) return null;

  const [flags, activityPage] = await Promise.all([
    listProjectFlags(project.key),
    api.audit.listForProject(project.key, {
      limit: ACTIVITY_LIMIT,
      from: new Date(
        now.getTime() - ACTIVITY_WINDOW_HOURS * HOUR_MS,
      ).toISOString(),
    }),
  ]);

  const selectedKey = environment?.key ?? null;
  const scopeNote = environment?.name ?? "No environment";

  // A flag is one row, so these are counts of flags rather than of rows.
  const enabledCount =
    selectedKey === null
      ? null
      : flags.filter((flag) => {
          const state = stateIn(flag, selectedKey);

          return state ? isServing(state) : false;
        }).length;

  const rolloutCount =
    selectedKey === null
      ? null
      : flags.filter((flag) => {
          const state = stateIn(flag, selectedKey);

          return state ? isRollingOut(state) : false;
        }).length;

  const archivedCount = flags.filter(
    (flag) => flag.status === "archived",
  ).length;

  const stats: HeroStat[] = [
    {
      id: "total",
      label: "Total Flags",
      value: formatInteger(flags.length),
      note: project.name,
    },
    {
      id: "enabled",
      label: "Enabled",
      value: enabledCount === null ? "Unavailable" : formatInteger(enabledCount),
      note: scopeNote,
    },
    {
      id: "rollout",
      label: "In Rollout",
      value: rolloutCount === null ? "Unavailable" : formatInteger(rolloutCount),
      note: scopeNote,
    },
    {
      id: "archived",
      label: "Archived",
      value: formatInteger(archivedCount),
      note: "Whole project",
    },
  ];

  const activeRollouts: ActiveRollout[] = flags
    .flatMap((flag) =>
      flag.environments
        .filter((state) => isRollingOut(state))
        .map((state) => ({
          flagKey: flag.key,
          environment: state.environmentName,
          percentage: state.rolloutPercentage,
        })),
    )
    .sort(
      (a, b) =>
        b.percentage - a.percentage || a.flagKey.localeCompare(b.flagKey),
    );

  const flagHealth: FlagHealth[] = environments.map((entry) => {
    const enabled = flags.filter((flag) => {
      const state = stateIn(flag, entry.key);

      return state ? isServing(state) : false;
    }).length;

    return {
      environment: entry.name,
      enabled,
      // Every flag of the project has a configuration here, so the remainder is
      // the count that is switched off.
      disabled: flags.length - enabled,
    };
  });

  const flagKeyById = new Map(flags.map((flag) => [flag.id, flag.key]));
  const environmentNameById = new Map(
    environments.map((entry) => [entry.id, entry.name]),
  );

  const recentActivity: RecentActivity[] = activityPage.data.map((entry) => {
    const verb = auditActionMeta[entry.action].verb;
    const environmentName =
      entry.environmentId === null
        ? null
        : (environmentNameById.get(entry.environmentId) ?? null);

    // `target` is a raw id, so it only earns a title when it can be named. When
    // it cannot, the action's own wording carries the row and the id stays out
    // of the screen entirely.
    const targetName =
      entry.target === null
        ? project.key
        : (flagKeyById.get(entry.target) ??
          environmentNameById.get(entry.target) ??
          (entry.target === project.id ? project.key : null));

    const action = environmentName ? `${verb} in ${environmentName}` : verb;
    const actor = entry.actorName ?? entry.actor;

    return {
      id: entry.id,
      action: entry.action,
      title: targetName ?? action,
      description: targetName ? `${action} · ${actor}` : actor,
      ageLabel: formatRelativeTime(entry.createdAt, now),
    };
  });

  return { stats, activeRollouts, flagHealth, recentActivity };
}
