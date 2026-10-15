import {
  MAX_PAGE_SIZE,
  type EnvironmentSummary,
} from "@iwifunni/contracts";
import { auditActionMeta } from "@/components/app/audit-log/audit-action-meta";
import type {
  AuditActorOption,
  AuditChangeField,
  AuditEnvironmentOption,
  AuditEventView,
  AuditLogViewProps,
} from "@/components/app/audit-log/audit-log-types";
import * as api from "@/lib/api";
import { formatClockTime, formatDateTime, formatDayLabel } from "@/lib/format";
import { getScope, listEnvironments } from "@/lib/scope";

const HOUR_MS = 60 * 60 * 1000;
const UNKNOWN_ENVIRONMENT = "Unknown environment";
const WORKSPACE_LABEL = "Workspace";

interface EnvironmentRef {
  environment: EnvironmentSummary;
  projectKey: string;
}

async function listWorkspaceEnvironments(
  projectKeys: string[],
  selectedProjectKey: string | null,
  selectedEnvironments: EnvironmentSummary[],
): Promise<EnvironmentRef[]> {
  const lists = await Promise.all(
    projectKeys.map((projectKey) =>
      projectKey === selectedProjectKey
        ? Promise.resolve(selectedEnvironments)
        : listEnvironments(projectKey),
    ),
  );

  return projectKeys.flatMap((projectKey, index) =>
    (lists[index] ?? []).map((environment) => ({ environment, projectKey })),
  );
}

/**
 * Environment names are unique per project, not per workspace, so a name two
 * projects share carries its project key.
 */
function environmentOptions(refs: EnvironmentRef[]): AuditEnvironmentOption[] {
  const nameCounts = new Map<string, number>();

  for (const ref of refs) {
    const name = ref.environment.name;
    nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
  }

  return refs.map((ref) => ({
    id: ref.environment.id,
    name:
      (nameCounts.get(ref.environment.name) ?? 0) > 1
        ? `${ref.environment.name} · ${ref.projectKey}`
        : ref.environment.name,
  }));
}

function formatChangeValue(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return JSON.stringify(value) ?? String(value);
}

/** `changes` is `unknown` on the wire, so every shape is rendered defensively. */
function describeChanges(changes: unknown): AuditChangeField[] {
  if (changes === null || changes === undefined) return [];

  if (typeof changes !== "object" || Array.isArray(changes)) {
    return [{ field: "value", value: formatChangeValue(changes) }];
  }

  return Object.entries(changes as Record<string, unknown>).map(
    ([field, value]) => ({ field, value: formatChangeValue(value) }),
  );
}

export async function loadAuditLog(now: Date): Promise<AuditLogViewProps> {
  const scope = await getScope();

  const [page, environmentRefs] = await Promise.all([
    api.audit.listForWorkspace({ limit: MAX_PAGE_SIZE }),
    listWorkspaceEnvironments(
      scope.projects.map((project) => project.key),
      scope.project?.key ?? null,
      scope.environments,
    ),
  ]);

  const environments = environmentOptions(environmentRefs);
  const environmentNames = new Map(
    environments.map((option) => [option.id, option.name]),
  );

  const events: AuditEventView[] = page.data.map((entry) => {
    const meta = auditActionMeta[entry.action];
    const environmentName = entry.environmentId
      ? (environmentNames.get(entry.environmentId) ?? UNKNOWN_ENVIRONMENT)
      : WORKSPACE_LABEL;
    const context = [
      entry.projectKey,
      entry.environmentId ? environmentName : null,
    ]
      .filter((part): part is string => part !== null && part !== "")
      .join(" · ");

    return {
      id: entry.id,
      dayLabel: formatDayLabel(entry.createdAt, now),
      actor: entry.actor,
      actorName: entry.actorName ?? entry.actor,
      action: entry.action,
      verb: meta.verb,
      target: entry.target,
      context: context || WORKSPACE_LABEL,
      environmentId: entry.environmentId,
      environmentName,
      targetFieldLabel: meta.targetLabel,
      changes: describeChanges(entry.changes),
      timeLabel: formatClockTime(entry.createdAt),
      absoluteLabel: formatDateTime(entry.createdAt),
      ageHours: (now.getTime() - new Date(entry.createdAt).getTime()) / HOUR_MS,
    };
  });

  const actors: AuditActorOption[] = [];
  const seenActors = new Set<string>();

  for (const event of events) {
    if (seenActors.has(event.actor)) continue;
    seenActors.add(event.actor);
    actors.push({ id: event.actor, name: event.actorName });
  }

  return {
    events,
    environments,
    actors,
    totalEvents: events.length,
    hasMore: page.nextCursor !== null,
  };
}
