"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilterIcon, MoreHorizontalIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import type {
  FlagEnvironmentSummary,
  FlagSummary,
} from "@iwifunni/contracts";
import {
  ArchiveFlagDialog,
  RestoreFlagDialog,
} from "@/components/app/flags/archive-flag-dialog";
import { EditFlagDialog } from "@/components/app/flags/edit-flag-dialog";
import { flagTabHref } from "@/components/app/flags/flag-tabs";
import {
  FlagStatusBadge,
  flagState,
} from "@/components/app/flags/flag-state-pill";
import { ProgressBar } from "@/components/app/progress-bar";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, flags as flagsApi } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

type StatusView = "active" | "rollout" | "disabled" | "archived";

/** `current` is the default view: everything the project still serves. */
type StatusFilter = "current" | "all" | StatusView;

const statusFilters: Array<{ value: StatusFilter; label: string }> = [
  { value: "current", label: "Current" },
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "rollout", label: "Rollout" },
  { value: "disabled", label: "Disabled" },
  { value: "archived", label: "Archived" },
];

const headerClass =
  "text-muted-foreground h-8 px-3 text-[10px] font-medium tracking-[0.1em] uppercase";
const cellClass = "px-3 py-2.5 text-[12px]";

/**
 * The flag's state in one environment, taken from the summaries every row
 * carries. Archiving is the flag's own, project-wide status, so it wins: a flag
 * that is merely disabled in the selected environment reads as `disabled`.
 */
function stateIn(flag: FlagSummary, environmentKey: string | null) {
  return (
    flag.environments.find(
      (environment) => environment.environmentKey === environmentKey,
    ) ??
    flag.environments[0] ??
    null
  );
}

/**
 * The status column's reading of one row.
 *
 * Derived from `flagState`, which the filter and the state pills also read, so
 * the three cannot disagree: a row that is disabled, or enabled at a rollout of
 * zero, serves nobody and reads as disabled rather than as a rollout under way.
 * There is no "on" reading — the status column separates `active` from `rollout`
 * by whether the flag is rolled out in full.
 */
function statusFor(
  flag: FlagSummary,
  environmentKey: string | null,
  override: FlagEnvironmentSummary | null = null,
): StatusView {
  if (flag.status === "archived") return "archived";

  const state = override ?? stateIn(flag, environmentKey);

  if (!state) return "disabled";

  switch (flagState(state).kind) {
    case "percentage":
      return "rollout";
    case "off":
      return "disabled";
    default:
      return "active";
  }
}

function searchableText(flag: FlagSummary): string {
  return [flag.key, flag.name, flag.owner, flag.description]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

export function FlagsTable({
  projectKey,
  flags,
  environmentKey,
  environmentName,
  now,
  protectedEnvironment = false,
}: {
  readonly projectKey: string;
  readonly flags: FlagSummary[];
  /**
   * The environment the list is narrowed to; each row carries the state of all
   * of them, so this is what the status and rollout columns are read from.
   */
  readonly environmentKey: string | null;
  readonly environmentName: string | null;
  /** Passed in so relative labels stay stable across hydration. */
  readonly now: string;
  /**
   * A protected environment refuses direct publishes, so the quick toggle would
   * only ever answer 409. The screens propose there instead.
   */
  readonly protectedEnvironment?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("current");
  const [editing, setEditing] = useState<FlagSummary | null>(null);
  const [archiving, setArchiving] = useState<FlagSummary | null>(null);
  const [restoring, setRestoring] = useState<FlagSummary | null>(null);
  /** The row a toggle is in flight for, so its switch can be disabled. */
  const [toggling, setToggling] = useState<string | null>(null);
  /** Where a toggle has already moved a row, before the server re-render lands. */
  const [overrides, setOverrides] = useState<
    Record<string, FlagEnvironmentSummary>
  >({});
  const [toggleError, setToggleError] = useState<{
    flagKey: string;
    message: string;
  } | null>(null);
  const nowDate = useMemo(() => new Date(now), [now]);
  const scopeLabel = environmentName ?? "all environments";
  const router = useRouter();

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return flags.filter((flag) => {
      const current = statusFor(
        flag,
        environmentKey,
        overrides[flag.key] ?? null,
      );

      if (status === "current") {
        if (current === "archived") return false;
      } else if (status !== "all" && current !== status) {
        return false;
      }
      if (!needle) return true;

      return searchableText(flag).includes(needle);
    });
  }, [flags, query, status, environmentKey, overrides]);

  /**
   * Flip one flag in one environment from its row.
   *
   * The switch moves first and is put back if the API refuses, so the row never
   * sits on a state the server declined. The server decides the rollout — it
   * opens at 100% — which is why the response, not the argument, is what the row
   * is seeded with.
   */
  async function handleToggle(flag: FlagSummary, next: boolean) {
    if (toggling !== null || environmentKey === null) return;

    setToggling(flag.key);
    setToggleError(null);

    const previous = stateIn(flag, environmentKey);
    setOverrides((current) => ({
      ...current,
      [flag.key]: {
        environmentKey,
        environmentName:
          previous?.environmentName ?? environmentName ?? environmentKey,
        enabled: next,
        rolloutPercentage: next
          ? 100
          : (previous?.rolloutPercentage ?? 0),
      },
    }));

    try {
      const updated = await flagsApi.setEnabled(
        projectKey,
        flag.key,
        environmentKey,
        next,
      );

      setOverrides((current) => ({
        ...current,
        [flag.key]: { ...current[flag.key]!, ...updated },
      }));
      router.refresh();
    } catch (toggleFailure) {
      setOverrides((current) => {
        const reverted = { ...current };
        delete reverted[flag.key];

        return reverted;
      });
      setToggleError({
        flagKey: flag.key,
        message:
          toggleFailure instanceof ApiError
            ? toggleFailure.message
            : "Could not change this flag. Please try again.",
      });
    } finally {
      setToggling(null);
    }
  }

  /**
   * Open one flag's page from anywhere in its row.
   *
   * The row carries controls of its own — the quick toggle and the actions menu
   * — so anything inside `[data-row-action]` is left for that control to handle.
   * Modified clicks are passed through rather than swallowed, because the key
   * cell is no longer an anchor of its own.
   */
  function openRow(href: string, target: EventTarget | null): void {
    if (target instanceof Element && target.closest("[data-row-action]")) return;

    router.push(href);
  }

  return (
    <section className="bg-card rounded-lg border">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search flags by name, key or owner"
            placeholder="Search flags by name, key or owner…"
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        <span className="bg-muted text-muted-foreground inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px]">
          {scopeLabel}
        </span>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5 text-[11px]">
              <FilterIcon aria-hidden="true" className="size-3.5" />
              Filters
              {status !== "current" ? (
                <span className="bg-primary text-primary-foreground ml-0.5 rounded-full px-1.5 text-[10px]">
                  1
                </span>
              ) : null}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-44">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={status}
              onValueChange={(value) => setStatus(value as StatusFilter)}
            >
              {statusFilters.map((option) => (
                <DropdownMenuRadioItem key={option.value} value={option.value}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <p className="text-muted-foreground text-[11px] sm:ml-auto">
          {visible.length} of {flags.length} flags in {scopeLabel}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={headerClass}>Flag</TableHead>
            <TableHead className={headerClass}>Enabled</TableHead>
            <TableHead className={headerClass}>Rollout</TableHead>
            <TableHead className={headerClass}>Updated</TableHead>
            <TableHead className={cn(headerClass, "w-10 text-right")}> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-muted-foreground py-10 text-center text-[12px]"
              >
                {flags.length === 0
                  ? "No flags in this environment yet."
                  : "No flags match your search."}
              </TableCell>
            </TableRow>
          ) : (
            visible.map((flag) => {
              // A row a toggle has already moved reads from the override until
              // the refreshed server data catches up.
              const state = overrides[flag.key] ?? stateIn(flag, environmentKey);
              // An archived flag serves its off variation everywhere, so the row
              // reads as serving nothing whatever its stored config says.
              const archived = flag.status === "archived";
              const serving = !archived && (state?.enabled ?? false);
              const subtitle = [flag.name, flag.owner, flag.description]
                .filter((value): value is string => Boolean(value))
                .join(" · ");
              const historyHref = environmentKey
                ? flagTabHref(projectKey, flag.key, environmentKey, "history")
                : `/projects/${projectKey}/flags/${flag.key}`;
              const flagHref = environmentKey
                ? `/projects/${projectKey}/flags/${flag.key}?environment=${environmentKey}`
                : `/projects/${projectKey}/flags/${flag.key}`;

              return (
                <TableRow
                  key={flag.key}
                  role="link"
                  tabIndex={0}
                  aria-label={`Open ${flag.key}`}
                  className="focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring cursor-pointer"
                  onClick={(event) => {
                    // A modified click is the reader asking for a new tab or
                    // window, which the router cannot honour.
                    if (event.metaKey || event.ctrlKey || event.shiftKey) return;

                    openRow(flagHref, event.target);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") return;
                    if (event.target !== event.currentTarget) return;

                    event.preventDefault();
                    openRow(flagHref, event.target);
                  }}
                >
                  <TableCell className={cellClass}>
                    <span className="flex items-center gap-2">
                      <span className="font-mono text-[12px] font-medium">
                        {flag.key}
                      </span>
                      {archived ? (
                        <FlagStatusBadge status={flag.status} />
                      ) : null}
                    </span>
                    <span className="text-muted-foreground block text-[11px]">
                      {subtitle}
                    </span>
                  </TableCell>

                  <TableCell className={cellClass}>
                    <div className="flex items-center">
                      <Switch
                        data-row-action
                        size="lg"
                        checked={serving}
                        disabled={
                          archived ||
                          protectedEnvironment ||
                          toggling !== null ||
                          environmentKey === null ||
                          state === null
                        }
                        onCheckedChange={(next) => {
                          void handleToggle(flag, next);
                        }}
                        aria-label={`${serving ? "Disable" : "Enable"} ${flag.key}${environmentName ? ` in ${environmentName}` : ""}`}
                        title={
                          archived
                            ? "This flag is archived — every environment serves its off variation. Restore it to change this."
                            : protectedEnvironment
                              ? `${environmentName ?? "This environment"} is protected — propose the change from the flag instead`
                              : undefined
                        }
                      />
                    </div>
                    {toggleError?.flagKey === flag.key ? (
                      <FieldError>{toggleError.message}</FieldError>
                    ) : null}
                  </TableCell>

                  <TableCell className={cellClass}>
                    {state && !archived ? (
                      <div className="flex w-28 items-center gap-2">
                        {serving ? (
                          <ProgressBar
                            value={state.rolloutPercentage}
                            label={`${flag.key} rollout in ${state.environmentName}`}
                          />
                        ) : (
                          // A flag that serves nobody has no progress to show; a
                          // bar here reads as a rollout that is under way.
                          <span
                            aria-hidden="true"
                            className="bg-muted h-1.5 w-full rounded-full"
                          />
                        )}
                        <span className="text-muted-foreground w-8 shrink-0 text-right text-[11px]">
                          {state.rolloutPercentage}%
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground text-[11px]">—</span>
                    )}
                  </TableCell>

                  <TableCell className={cn(cellClass, "text-muted-foreground")}>
                    {formatRelativeTime(flag.updatedAt, nowDate)}
                  </TableCell>

                  <TableCell className={cn(cellClass, "text-right")}>
                    <div className="flex items-center justify-end gap-1">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            data-row-action
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`More actions for ${flag.key}`}
                          >
                            <MoreHorizontalIcon aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel>{flag.key}</DropdownMenuLabel>
                          <DropdownMenuItem
                            onSelect={() => {
                              setEditing(flag);
                            }}
                          >
                            Edit details
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={historyHref}>View history</Link>
                          </DropdownMenuItem>
                          {flag.status === "archived" ? (
                            <DropdownMenuItem
                              onSelect={() => {
                                setRestoring(flag);
                              }}
                            >
                              Restore
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setArchiving(flag);
                              }}
                            >
                              Archive
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <EditFlagDialog
        projectKey={projectKey}
        flag={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
      <ArchiveFlagDialog
        projectKey={projectKey}
        flag={archiving}
        onClose={() => {
          setArchiving(null);
        }}
      />
      <RestoreFlagDialog
        projectKey={projectKey}
        flag={restoring}
        onClose={() => {
          setRestoring(null);
        }}
      />
    </section>
  );
}
