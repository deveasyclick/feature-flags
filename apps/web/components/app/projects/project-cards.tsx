import type { ReactNode } from "react";
import Link from "next/link";
import { ArchiveIcon, ArrowRightIcon, FlagIcon, GlobeIcon } from "lucide-react";
import { cn } from "cn";
import type {
  EnvironmentSummary,
  FlagSummary,
  Project,
  ProjectMember,
} from "@iwifunni/contracts";
import {
  environmentColorSwatch,
  environmentColorTone,
} from "@/components/app/environments/environment-colors";
import {
  FlagStatePill,
  FlagStatusBadge,
  flagState,
  type FlagState,
} from "@/components/app/flags/flag-state-pill";
import {
  countLabel,
  type CappedCount,
} from "@/components/app/environments/capped-count";
import { sectionActionClass, SectionCard } from "@/components/app/page-header";
import { projectGlyphs } from "@/components/app/projects/project-glyphs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolveEnvironmentColor } from "@/lib/environment-color";
import { formatRelativeTime } from "@/lib/format";
import { initialsOf } from "@/lib/scope";

/**
 * One project as the list screens render it.
 *
 * The API returns the project and its environments separately, and carries no
 * flag or key totals, so the page fetches one capped page of each and passes the
 * derived counts down here.
 */
export interface ProjectCardData {
  project: Project;
  environments: EnvironmentSummary[];
  flagCount: CappedCount;
  apiKeyCount: CappedCount;
}

/** Environment pills, tinted with each environment's own colour. */
function EnvironmentPills({
  environments,
  limit,
}: {
  readonly environments: EnvironmentSummary[];
  /** Show this many, then a `+N` chip. Omit to show them all. */
  readonly limit?: number;
}) {
  const shown = limit ? environments.slice(0, limit) : environments;
  const hidden = environments.length - shown.length;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {shown.map((environment) => {
        const color = resolveEnvironmentColor(environment.color);

        return (
          <span
            key={environment.key}
            className={cn(
              "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium",
              environmentColorTone[color],
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                environmentColorSwatch[color],
              )}
            />
            {environment.name}
          </span>
        );
      })}
      {hidden > 0 ? (
        <span className="bg-muted text-muted-foreground rounded-md px-1.5 py-0.5 text-[10px] font-medium">
          +{hidden}
        </span>
      ) : null}
    </span>
  );
}

/** Count tile shown across the bottom of a project card. */
function ProjectStatTile({
  value,
  label,
  tone,
}: {
  readonly value: ReactNode;
  readonly label: string;
  readonly tone: string;
}) {
  return (
    <div className={cn("rounded-md px-2.5 py-1.5 text-center", tone)}>
      <p className="text-[14px] font-semibold">{value}</p>
      <p className="text-[10px] opacity-80">{label}</p>
    </div>
  );
}

/** One project as summarised on the Projects list. */
export function ProjectCard({ data }: { readonly data: ProjectCardData }) {
  const { project, environments, flagCount, apiKeyCount } = data;
  const Glyph = projectGlyphs[resolveEnvironmentColor(project.color)];

  return (
    <article className="bg-card flex flex-col rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            environmentColorTone[resolveEnvironmentColor(project.color)],
          )}
        >
          <Glyph aria-hidden="true" className="size-4" />
        </span>
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {project.name}
        </h2>
      </div>

      <p className="text-muted-foreground mt-2 line-clamp-2 text-[11px] leading-5">
        {project.description ?? "No description yet."}
      </p>

      <div className="mt-3">
        <EnvironmentPills environments={environments} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <ProjectStatTile
          value={project.environmentCount}
          label="envs"
          tone="bg-primary/10 text-primary"
        />
        <ProjectStatTile
          value={countLabel(flagCount)}
          label="flags"
          tone="bg-primary-ink/10 text-primary-ink"
        />
        <ProjectStatTile
          value={countLabel(apiKeyCount)}
          label="keys"
          tone="bg-purple-ink/10 text-purple-ink"
        />
      </div>

      <Link
        href={`/projects/${project.key}`}
        className="text-muted-foreground hover:text-foreground mt-4 flex items-center justify-between gap-2 border-t pt-3 text-[12px] transition-colors"
      >
        Open project
        <ArrowRightIcon aria-hidden="true" className="size-3.5" />
      </Link>
    </article>
  );
}

/** The project cards, with the empty state the design does not cover. */
export function ProjectGrid({ projects }: { readonly projects: ProjectCardData[] }) {
  if (projects.length === 0) {
    return (
      <section className="bg-card text-muted-foreground rounded-lg border border-dashed p-6 text-[13px]">
        No projects yet. Create one to give your flags and environments a home.
      </section>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard key={project.project.key} data={project} />
      ))}
    </div>
  );
}

/** Table header style used by every project table. */
const tableHeadClass =
  "text-muted-foreground h-8 text-[10px] font-medium tracking-[0.1em] uppercase";

/** Every project in one table: environments, flags, keys and last change. */
export function ProjectsOverviewCard({
  projects,
  now,
}: {
  readonly projects: ProjectCardData[];
  /** The moment "last changed" is measured against; one per render. */
  readonly now: Date;
}) {
  return (
    <SectionCard
      title="Projects overview"
      action={
        <span className="text-muted-foreground text-[11px]">
          Environments, flags and SDK keys per project
        </span>
      }
      bodyClassName="p-0"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={cn(tableHeadClass, "pl-4")}>
              Project
            </TableHead>
            <TableHead className={tableHeadClass}>Environments</TableHead>
            <TableHead className={tableHeadClass}>Flags</TableHead>
            <TableHead className={tableHeadClass}>SDK keys</TableHead>
            <TableHead className={tableHeadClass}>Last changed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {projects.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={5}
                className="text-muted-foreground py-10 text-center text-[12px]"
              >
                No projects yet.
              </TableCell>
            </TableRow>
          ) : (
            projects.map(
              ({ project, environments, flagCount, apiKeyCount }) => {
                const Glyph =
                  projectGlyphs[resolveEnvironmentColor(project.color)];

                return (
                  <TableRow key={project.key}>
                    <TableCell className="pl-4">
                      <span className="flex items-center gap-2.5">
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-md",
                            environmentColorTone[
                              resolveEnvironmentColor(project.color)
                            ],
                          )}
                        >
                          <Glyph aria-hidden="true" className="size-3.5" />
                        </span>
                        <span className="min-w-0">
                          <Link
                            href={`/projects/${project.key}`}
                            className="block truncate text-[12px] font-medium hover:underline"
                          >
                            {project.name}
                          </Link>
                          <span className="text-muted-foreground block truncate text-[11px]">
                            {project.key} ·{" "}
                            {project.ownerTeam
                              ? `Owned by ${project.ownerTeam}`
                              : `${project.environmentCount} environments`}
                          </span>
                        </span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <EnvironmentPills
                        environments={environments}
                        limit={2}
                      />
                    </TableCell>
                    <TableCell className="text-[12px]">
                      {countLabel(flagCount)}
                    </TableCell>
                    <TableCell className="text-[12px]">
                      {countLabel(apiKeyCount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[11px]">
                      {formatRelativeTime(project.updatedAt, now)}
                    </TableCell>
                  </TableRow>
                );
              },
            )
          )}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

/** Environments of one project, with how many flags each enables. */
export function ProjectEnvironmentsCard({
  environments,
  enabledByEnvironment,
}: {
  readonly environments: EnvironmentSummary[];
  /** Enabled flag count per environment key. */
  readonly enabledByEnvironment: Record<string, CappedCount>;
}) {
  return (
    <SectionCard
      title="Environments"
      action={
        <Link href="/environments/new" className={sectionActionClass}>
          New environment
        </Link>
      }
      bodyClassName="p-0"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className={cn(tableHeadClass, "pl-4")}>
              Environment
            </TableHead>
            <TableHead className={tableHeadClass}>Key</TableHead>
            <TableHead className={tableHeadClass}>Flags</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {environments.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={3}
                className="text-muted-foreground py-10 text-center text-[12px]"
              >
                No environments yet.
              </TableCell>
            </TableRow>
          ) : (
            environments.map((environment) => (
              <TableRow key={environment.key}>
                <TableCell className="pl-4 text-[12px] font-medium">
                  <Link
                    href={`/environments/${environment.key}`}
                    className="hover:underline"
                  >
                    {environment.name}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground font-mono text-[11px]">
                  {environment.key}
                </TableCell>
                <TableCell className="text-[12px]">
                  {countLabel(enabledCount(enabledByEnvironment, environment.key))}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </SectionCard>
  );
}

/** Tile tint for a flag row, following the state it renders. */
function flagTone(state: FlagState): string {
  if (state.kind === "on") return "bg-ok-ink/10 text-ok-ink";
  if (state.kind === "percentage") return "bg-primary-ink/10 text-primary-ink";

  return "bg-muted text-muted-foreground";
}

function enabledCount(
  counts: Record<string, CappedCount>,
  environmentKey: string,
): CappedCount {
  return counts[environmentKey] ?? { count: 0, truncated: false };
}

interface ProjectFlagsCardProps {
  readonly projectKey: string;
  readonly flags: FlagSummary[];
  /** Cap the list and add a "View all" link, as the design does on Overview. */
  readonly limit?: number;
  /**
   * The environment each row's state is read from. Omit to show the flag's own
   * status only, which is what the card falls back to.
   */
  readonly environmentKey?: string | null;
  /** Named beside each row so the state is never read as project-wide. */
  readonly environmentName?: string | null;
}

/**
 * Flags this project owns.
 *
 * One row per flag: the identity status is the flag's own, and the state pill
 * belongs to the environment named beside it.
 */
export function ProjectFlagsCard({
  projectKey,
  flags,
  limit,
  environmentKey = null,
  environmentName = null,
}: ProjectFlagsCardProps) {
  const visible = limit ? flags.slice(0, limit) : flags;

  return (
    <SectionCard
      title="Flags in this project"
      action={
        limit ? (
          <Link
            href={`/projects/${projectKey}/flags`}
            className={sectionActionClass}
          >
            View all
          </Link>
        ) : undefined
      }
    >
      {visible.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">
          No flags in this project yet.
        </p>
      ) : (
        <ul className="divide-y">
          {visible.map((flag) => {
            const summary =
              environmentKey === null
                ? null
                : (flag.environments.find(
                    (environment) =>
                      environment.environmentKey === environmentKey,
                  ) ?? null);
            const state = summary ? flagState(summary) : null;

            return (
              <li
                key={flag.key}
                className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md",
                    state
                      ? flagTone(state)
                      : flag.status === "archived"
                        ? "bg-muted text-muted-foreground"
                        : "bg-ok-ink/10 text-ok-ink",
                  )}
                >
                  <FlagIcon aria-hidden="true" className="size-3.5" />
                </span>
                <Link
                  href={
                    environmentKey === null
                      ? `/projects/${projectKey}/flags/${flag.key}`
                      : `/projects/${projectKey}/flags/${flag.key}?environment=${environmentKey}`
                  }
                  className="min-w-0 flex-1 truncate font-mono text-[12px] hover:underline"
                >
                  {flag.key}
                </Link>
                {environmentName ? (
                  <span className="bg-muted text-muted-foreground shrink-0 rounded-md px-1.5 py-0.5 text-[10px]">
                    {environmentName}
                  </span>
                ) : null}
                <FlagStatusBadge status={flag.status} />
                {state ? <FlagStatePill state={state} label="long" /> : null}
              </li>
            );
          })}
        </ul>
      )}
    </SectionCard>
  );
}

/** Counts and owner of one project. */
export function ProjectSummaryCard({
  project,
  flagCount,
  segmentCount,
  apiKeyCount,
}: {
  readonly project: Project;
  readonly flagCount: CappedCount;
  readonly segmentCount: CappedCount;
  readonly apiKeyCount: CappedCount;
}) {
  const tiles = [
    { label: "Environments", value: String(project.environmentCount) },
    { label: "Flags", value: countLabel(flagCount) },
    { label: "Segments", value: countLabel(segmentCount) },
    { label: "SDK keys", value: countLabel(apiKeyCount) },
  ];

  return (
    <SectionCard title="Project summary">
      <dl className="grid grid-cols-2 gap-2">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-muted rounded-lg px-3 py-2.5">
            <dt className="text-muted-foreground text-[10px]">{tile.label}</dt>
            <dd className="mt-1 text-[15px] font-semibold">{tile.value}</dd>
          </div>
        ))}
      </dl>

      {project.ownerTeam ? (
        <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3">
          <span className="text-muted-foreground text-[11px]">Owner team</span>
          <span className="truncate text-[12px] font-medium">
            {project.ownerTeam}
          </span>
        </div>
      ) : null}
    </SectionCard>
  );
}

/** The environment flags resolve in, and the rest of the project's set. */
export function DefaultEnvironmentCard({
  environments,
  enabledByEnvironment,
  defaultEnvironmentKey,
}: {
  readonly environments: EnvironmentSummary[];
  /** Enabled flag count per environment key. */
  readonly enabledByEnvironment: Record<string, CappedCount>;
  readonly defaultEnvironmentKey: string | null;
}) {
  const ordered = [...environments].sort(
    (a, b) => Number(b.isDefault) - Number(a.isDefault),
  );

  return (
    <SectionCard title="Default environment">
      <p className="text-muted-foreground text-[11px] leading-5">
        Flags resolve here unless an environment override is set.
      </p>

      {ordered.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-[12px]">
          No environments yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-3">
          {ordered.map((environment) => (
            <li key={environment.key} className="flex items-center gap-2.5">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  environmentColorTone[
                    resolveEnvironmentColor(environment.color)
                  ],
                )}
              >
                <GlobeIcon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {environment.name}
                </span>
                <span className="text-muted-foreground block text-[11px]">
                  {countLabel(
                    enabledCount(enabledByEnvironment, environment.key),
                  )}{" "}
                  flags on
                </span>
              </span>
              {environment.key === defaultEnvironmentKey ? (
                <span className="text-primary shrink-0 text-[11px] font-medium">
                  Default
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

/** Danger zone. The action is disabled until the API can archive projects. */
export function ArchiveProjectCard() {
  return (
    <section className="border-danger-ink/30 bg-danger-ink/5 rounded-lg border p-4">
      <h2 className="text-danger-ink text-[13px] font-medium">
        Archive project
      </h2>
      <p className="text-muted-foreground mt-1 text-[11px] leading-5">
        Archiving hides this project and its environments from the switcher.
        Data is retained for 30 days.
      </p>

      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Archive project — coming soon"
          className="border-danger-ink/40 text-danger-ink gap-1.5 text-[11px]"
        >
          <ArchiveIcon aria-hidden="true" className="size-3.5" />
          Archive project
        </Button>
      </div>
    </section>
  );
}

const roleLabels: Record<ProjectMember["role"], string> = {
  owner: "Owner",
  admin: "Admin",
  engineer: "Engineer",
  viewer: "Viewer",
};

/** The project's team, as the members endpoint returns it. */
export function ProjectMembersCard({ members }: { readonly members: ProjectMember[] }) {
  return (
    <SectionCard
      title="Members"
      action={
        <span className="text-muted-foreground text-[11px]">
          {members.length} members
        </span>
      }
    >
      {members.length === 0 ? (
        <p className="text-muted-foreground text-[13px]">No members yet.</p>
      ) : (
        <ul className="divide-y">
          {members.map((member) => (
            <li
              key={member.id}
              className="flex items-center gap-2.5 py-2.5 first:pt-0 last:pb-0"
            >
              <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-medium">
                {initialsOf(member.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {member.name}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {member.email}
                </span>
              </span>
              <Badge variant="secondary" className="text-[10px]">
                {roleLabels[member.role]}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
