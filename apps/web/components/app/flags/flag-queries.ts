import { cache } from "react";
import { notFound } from "next/navigation";

import {
  MAX_PAGE_SIZE,
  type EnvironmentSummary,
  type FlagChangeRequest,
  type FlagDetail,
  type FlagEnvironmentConfig,
  type FlagSummary,
  type FlagVersion,
  type Project,
  type WorkspaceFlagSummary,
} from "@iwifunni/contracts";

import {
  ApiError,
  changeRequests as changeRequestsApi,
  flags as flagsApi,
} from "@/lib/api";
import { findProject, getScope, listEnvironments } from "@/lib/scope";

export interface FlagScope {
  projectKey: string;
  environmentKey: string;
  environmentName: string;
  /** A protected environment refuses direct publishes; the screens propose instead. */
  protectedEnvironment: boolean;
}

/**
 * Resolve one environment of the selected project, from the route rather than
 * the cookie, so an environment-scoped flag URL names its own environment.
 */
export const requireFlagScope = cache(
  async (environmentKey: string): Promise<FlagScope> => {
    const { project } = await getScope();

    if (!project) notFound();

    const environments = await listEnvironments(project.key, {
      includeArchived: true,
    });
    const environment = environments.find((entry) => entry.key === environmentKey);

    if (!environment) notFound();

    return {
      projectKey: project.key,
      environmentKey: environment.key,
      environmentName: environment.name,
      protectedEnvironment: environment.isProtected,
    };
  },
);

/**
 * The environment a flag screen reads when the URL does not name one.
 *
 * The dashboard's selected environment comes first, because that is the
 * environment the reader is already looking at, but only when the project in
 * the route actually owns it. Otherwise the project's own default applies, and
 * failing that its first environment.
 */
export function defaultEnvironment(
  project: Project,
  environments: EnvironmentSummary[],
  selectedKey: string | null | undefined,
): EnvironmentSummary | null {
  return (
    environments.find((entry) => entry.key === selectedKey) ??
    environments.find((entry) => entry.id === project.defaultEnvironmentId) ??
    environments.find((entry) => entry.isDefault) ??
    environments[0] ??
    null
  );
}

/**
 * Resolve the project in the route plus the environment a flag page renders.
 *
 * Unlike `requireFlagScope` the environment is optional: the canonical flag page
 * carries it in `?environment=`, so an absent or unknown key falls back to the
 * project's default rather than failing the route.
 */
export const requireFlagPageScope = cache(
  async (
    projectKey: string,
    requestedEnvironmentKey?: string,
  ): Promise<FlagScope> => {
    const project = await findProject(projectKey);

    if (!project) notFound();

    const environments = await listEnvironments(projectKey, {
      includeArchived: true,
    });
    const { environment: selected } = await getScope();

    const environment = defaultEnvironment(
      project,
      environments,
      requestedEnvironmentKey ?? selected?.key,
    );

    if (!environment) notFound();

    return {
      projectKey: project.key,
      environmentKey: environment.key,
      environmentName: environment.name,
      protectedEnvironment: environment.isProtected,
    };
  },
);

/**
 * The pending proposal for one flag in one environment, if there is one.
 *
 * At most one can be pending — a newer proposal supersedes the older — so the
 * screens render a single piece of approval state rather than a queue.
 */
export async function loadPendingChangeRequest(
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): Promise<FlagChangeRequest | null> {
  const page = await changeRequestsApi.list(projectKey, flagKey, {
    environmentKey,
    status: "pending",
    limit: 1,
  });

  return page.data[0] ?? null;
}

/** One flag's identity, its environment summaries and its variations. */
export const loadFlagDetail = cache(
  async (projectKey: string, flagKey: string): Promise<FlagDetail> => {
    try {
      return await flagsApi.get(projectKey, flagKey);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
);

/** What one flag does in one environment. */
export const loadFlagConfig = cache(
  async (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
  ): Promise<FlagEnvironmentConfig> => {
    try {
      return await flagsApi.getEnvironmentConfig(
        projectKey,
        flagKey,
        environmentKey,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) notFound();
      throw error;
    }
  },
);

/** Every flag one project holds in one environment. */
export async function listEnvironmentFlags(
  projectKey: string,
  environmentKey: string,
): Promise<FlagSummary[]> {
  const collected: FlagSummary[] = [];
  let cursor: string | undefined;

  do {
    const page = await flagsApi.list(projectKey, {
      environmentKey,
      limit: MAX_PAGE_SIZE,
      cursor,
    });

    collected.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return collected;
}

/**
 * Every flag one project owns.
 *
 * A flag is project-scoped, so this is one list call whatever the number of
 * environments: each row already carries how the flag stands in all of them.
 * The cursor is followed because the screens that count flags need all of them.
 */
export async function listProjectFlags(
  projectKey: string,
): Promise<FlagSummary[]> {
  const collected: FlagSummary[] = [];
  let cursor: string | undefined;

  do {
    const page = await flagsApi.list(projectKey, {
      limit: MAX_PAGE_SIZE,
      cursor,
    });

    collected.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return collected;
}

/** Every project's flags, for the workspace-wide project list. */
export async function listWorkspaceFlags(): Promise<WorkspaceFlagSummary[]> {
  const collected: WorkspaceFlagSummary[] = [];
  let cursor: string | undefined;

  do {
    const page = await flagsApi.listWorkspace({
      limit: MAX_PAGE_SIZE,
      cursor,
    });

    collected.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return collected;
}

/** Every version of one flag, oldest page first. */
export async function listFlagVersions(
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): Promise<FlagVersion[]> {
  const collected: FlagVersion[] = [];
  let cursor: string | undefined;

  do {
    const page = await flagsApi.versions(projectKey, flagKey, environmentKey, {
      limit: MAX_PAGE_SIZE,
      cursor,
    });

    collected.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return collected;
}
