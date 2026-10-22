"use client";

import { useMemo, useState } from "react";
import {
  CalendarIcon,
  LayersIcon,
  SearchIcon,
  UserRoundIcon,
} from "lucide-react";
import { AuditTimeline } from "@/components/app/audit-log/audit-timeline";
import { ChangeDetailsPanel } from "@/components/app/audit-log/change-details-panel";
import {
  groupEventsByDay,
  type AuditLogViewProps,
} from "@/components/app/audit-log/audit-log-types";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { auditCsv } from "./audit-csv";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatInteger } from "@/lib/format";

type RangeFilter = "24h" | "7d" | "30d";

const rangeHours: Record<RangeFilter, number> = {
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const rangeOptions: Array<{ value: RangeFilter; label: string }> = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

const ALL = "all";

/**
 * Audit log screen.
 *
 * The only client boundary on the page: search, the three filters and the
 * selected row are local state. Every label it renders arrives pre-formatted
 * from the loader, so filtering never re-formats a date and the server render
 * and hydration stay in step.
 */
export function AuditLogView({
  events,
  environments,
  actors,
  totalEvents,
  hasMore,
}: AuditLogViewProps) {
  const [query, setQuery] = useState("");
  const [environment, setEnvironment] = useState(ALL);
  const [actor, setActor] = useState(ALL);
  const [range, setRange] = useState<RangeFilter>("7d");
  const [selectedId, setSelectedId] = useState<string | null>(
    events[0]?.id ?? null,
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return events.filter((event) => {
      if (environment !== ALL && event.environmentId !== environment) {
        return false;
      }
      if (actor !== ALL && event.actor !== actor) return false;
      if (event.ageHours > rangeHours[range]) return false;
      if (!needle) return true;

      return [event.actorName, event.verb, event.target ?? "", event.context]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [events, query, environment, actor, range]);

  const groups = useMemo(() => groupEventsByDay(visible), [visible]);

  const filtered =
    query.trim() !== "" ||
    environment !== ALL ||
    actor !== ALL ||
    range !== "7d";

  // A filtered-out selection falls back to the newest event still on screen.
  const selected =
    visible.find((event) => event.id === selectedId) ?? visible[0] ?? null;

  const totalLabel = `${formatInteger(totalEvents)}${hasMore ? "+" : ""}`;

  function exportVisible() {
    const url = URL.createObjectURL(new Blob(["\uFEFF", auditCsv(visible)], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "flags-audit-log.csv";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.45fr)]">
      <section className="bg-card rounded-lg border">
        <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center">
          <Button variant="outline" size="sm" onClick={exportVisible} disabled={!visible.length}>Export visible CSV</Button>
          <div className="relative w-full sm:max-w-xs">
            <SearchIcon
              aria-hidden="true"
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search activity by actor, flag or segment"
              placeholder="Search activity, actors, flags…"
              className="h-8 pl-8 text-[13px]"
            />
          </div>

          <Select value={environment} onValueChange={setEnvironment}>
            <SelectTrigger
              aria-label="Filter by environment"
              className="h-8 w-full text-[11px] sm:w-fit"
            >
              <LayersIcon
                aria-hidden="true"
                className="text-muted-foreground size-3.5"
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All environments</SelectItem>
              {environments.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger
              aria-label="Filter by actor"
              className="h-8 w-full text-[11px] sm:w-fit"
            >
              <UserRoundIcon
                aria-hidden="true"
                className="text-muted-foreground size-3.5"
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actors</SelectItem>
              {actors.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={range}
            onValueChange={(value) => setRange(value as RangeFilter)}
          >
            <SelectTrigger
              aria-label="Filter by time range"
              className="h-8 w-full text-[11px] sm:w-fit"
            >
              <CalendarIcon
                aria-hidden="true"
                className="text-muted-foreground size-3.5"
              />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <p className="text-muted-foreground text-[11px] sm:ml-auto">
            {filtered
              ? `${formatInteger(visible.length)} of ${totalLabel} events`
              : `${totalLabel} events`}
          </p>
        </div>

        <div className="p-2">
          <AuditTimeline
            groups={groups}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
          />
        </div>
      </section>

      <ChangeDetailsPanel event={selected} />
    </div>
  );
}
