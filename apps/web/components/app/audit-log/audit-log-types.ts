import type { AuditAction } from "@iwifunni/contracts";

/** One recorded field change, stringified for display. */
export interface AuditChangeField {
  field: string;
  value: string;
}

/** One event as the timeline and the details panel render it. */
export interface AuditEventView {
  id: string;
  /** Day heading, e.g. `Today`, `Yesterday`, or `12 Sep`. */
  dayLabel: string;
  actor: string;
  /** Snapshotted name, falling back to the id for rows written before it existed. */
  actorName: string;
  action: AuditAction;
  /** What the actor did, e.g. `changed rollout on`. */
  verb: string;
  target: string | null;
  /** The muted line under the row, e.g. `checkout · Production`. */
  context: string;
  environmentId: string | null;
  environmentName: string;
  /** Label for the target in the details panel, e.g. `Flag`. */
  targetFieldLabel: string;
  changes: AuditChangeField[];
  /** Clock time beside the row, e.g. `6:12 AM`. */
  timeLabel: string;
  /** Absolute time in the details panel, e.g. `Sep 15, 2026 05:31`. */
  absoluteLabel: string;
  /** Whole hours since the change; used by the range filter. */
  ageHours: number;
}

export interface AuditEventGroup {
  label: string;
  events: AuditEventView[];
}

export interface AuditEnvironmentOption {
  id: string;
  name: string;
}

export interface AuditActorOption {
  id: string;
  name: string;
}

export interface AuditLogViewProps {
  events: AuditEventView[];
  environments: AuditEnvironmentOption[];
  /** Distinct actors, in the order they first appear. */
  actors: AuditActorOption[];
  /** Events on the loaded page; the API has more when `hasMore`. */
  totalEvents: number;
  hasMore: boolean;
}

/**
 * Group events under their day heading, keeping the order the events arrived in.
 *
 * The client calls this after filtering; the loader produces the same shape, so
 * a filtered and an unfiltered timeline cannot diverge.
 */
export function groupEventsByDay(events: AuditEventView[]): AuditEventGroup[] {
  const byDay = new Map<string, AuditEventView[]>();

  for (const event of events) {
    const bucket = byDay.get(event.dayLabel);
    if (bucket) bucket.push(event);
    else byDay.set(event.dayLabel, [event]);
  }

  return [...byDay].map(([label, dayEvents]) => ({ label, events: dayEvents }));
}
