import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  DefaultEnvironmentCard,
  ProjectEnvironmentsCard,
  ProjectFlagsCard,
  ProjectSummaryCard,
} from "@/components/app/projects/project-cards";
import {
  cappedCount,
  environmentFlagCounts,
  type CappedCount,
} from "@/components/app/environments/capped-count";
import { listProjectFlags } from "@/components/app/flags/flag-queries";
import * as api from "@/lib/api";
import { loadProject } from "./load-project";
import { ProjectLifecycle } from "@/components/app/projects/project-lifecycle";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/projects/[key]">,
): Promise<Metadata> {
  const { key } = await props.params;
  const project = await loadProject(key);

  return {
    title: project ? `${project.name} · Projects` : "Project",
    description:
      "Environments, flags, and keys for this project, scoped to one workspace.",
  };
}

export default async function ProjectEnvironmentsPage(
  props: PageProps<"/projects/[key]">,
) {
  const { key } = await props.params;
  const project = await loadProject(key);

  if (!project) notFound();
  if (project.archivedAt) return <ProjectLifecycle projectKey={project.key} name={project.name} archived />;

  const [environmentPage, apiKeyPage, segmentPage, flags] = await Promise.all([
    api.environments.list(project.key),
    api.apiKeys.list(project.key),
    api.segments.list(project.key),
    // One list for the whole project: a flag is project-scoped and each row
    // already carries its state in every environment.
    listProjectFlags(project.key),
  ]);

  const environments = environmentPage.data;
  const enabledByEnvironment: Record<string, CappedCount> = {};

  for (const environment of environments) {
    enabledByEnvironment[environment.key] = environmentFlagCounts(
      flags,
      environment.key,
      false,
    ).enabled;
  }

  const defaultEnvironmentKey =
    environments.find(
      (environment) => environment.id === project.defaultEnvironmentId,
    )?.key ??
    environments.find((environment) => environment.isDefault)?.key ??
    environments[0]?.key ??
    null;
  const defaultEnvironment =
    environments.find((environment) => environment.key === defaultEnvironmentKey) ??
    null;

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <ProjectEnvironmentsCard
          environments={environments}
          enabledByEnvironment={enabledByEnvironment}
        />
        <ProjectFlagsCard
          projectKey={project.key}
          flags={flags}
          limit={4}
          environmentKey={defaultEnvironmentKey}
          environmentName={defaultEnvironment?.name ?? null}
        />
      </div>

      <div className="space-y-3">
        <ProjectSummaryCard
          project={project}
          flagCount={{ count: flags.length, truncated: false }}
          segmentCount={cappedCount(segmentPage)}
          apiKeyCount={cappedCount(apiKeyPage)}
        />
        <DefaultEnvironmentCard
          environments={environments}
          enabledByEnvironment={enabledByEnvironment}
          defaultEnvironmentKey={defaultEnvironmentKey}
        />
        <ProjectLifecycle projectKey={project.key} name={project.name} />
      </div>
    </div>
  );
}
