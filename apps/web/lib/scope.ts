/**
 * The project and environment the dashboard is scoped to.
 *
 * Every resource the API exposes hangs off a project key, so the chrome has to
 * resolve one before any screen can render. The switchers in the sidebar write
 * the selection to cookies (see `lib/scope-actions.ts`) and this module reads it
 * back, falling back to the first project and that project's default
 * environment so a first visit renders without a choice having been made.
 *
 * Resolved once per request: `cache()` dedupes the calls every screen and the
 * layout would otherwise repeat.
 */

import { cache } from "react";
import { cookies } from "next/headers";

import {
  MAX_PAGE_SIZE,
  type EnvironmentSummary,
  type MeResponse,
  type Project,
} from "@iwifunni/contracts";

import * as api from "@/lib/api";

export const PROJECT_COOKIE = "iwifunni.project";
export const ENVIRONMENT_COOKIE = "iwifunni.environment";

/** The signed-in user as the chrome renders them. */
export interface ChromeUser {
  name: string;
  email: string;
  initials: string;
  /** Workspace-level role, e.g. `owner`. */
  role: string;
  image: string | null;
}

export interface DashboardScope {
  /** Every project in the workspace, in the order the switcher lists them. */
  projects: Project[];
  /** The selected project, or `null` when the workspace has none yet. */
  project: Project | null;
  environments: EnvironmentSummary[];
  environment: EnvironmentSummary | null;
}

/** Two initials for an avatar, derived from the display name. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) return "?";

  const first = words[0]?.[0] ?? "";
  const last = words.length === 1 ? "" : (words[words.length - 1]?.[0] ?? "");

  return `${first}${last}`.toUpperCase();
}

/** The signed-in user in the shape the sidebar, topbar and profile screens use. */
export function toChromeUser(session: MeResponse): ChromeUser {
  return {
    name: session.user.name,
    email: session.user.email,
    initials: initialsOf(session.user.name),
    role: session.workspace?.role ?? "member",
    image: session.user.image ?? null,
  };
}

async function readCookie(name: string): Promise<string | null> {
  try {
    return (await cookies()).get(name)?.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Every environment in a project, following the cursor to the last page.
 *
 * A project that outgrows one page must still render its whole environment set,
 * because the chrome is meaningless with a subset. Archived environments are
 * excluded unless a caller asks for them, so the switcher only ever offers
 * environments that are in service.
 */
export async function listEnvironments(
  projectKey: string,
  { includeArchived = false }: { includeArchived?: boolean } = {},
): Promise<EnvironmentSummary[]> {
  const collected: EnvironmentSummary[] = [];
  let cursor: string | undefined;

  do {
    const page = await api.environments.list(projectKey, {
      limit: MAX_PAGE_SIZE,
      cursor,
      includeArchived: includeArchived || undefined,
    });

    collected.push(...page.data);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return collected;
}

/**
 * Resolve the current project and environment.
 *
 * A selected key that no longer exists — a project deleted in another tab, a
 * stale cookie — falls through to the default rather than failing, because the
 * fallback is always renderable and the alternative is a dead dashboard.
 */
export const getScope = cache(async (): Promise<DashboardScope> => {
  const projects = await api.projects.list();
  const selectedProjectKey = await readCookie(PROJECT_COOKIE);

  const project =
    projects.find((item) => item.key === selectedProjectKey) ??
    projects[0] ??
    null;

  if (!project) {
    return { projects, project: null, environments: [], environment: null };
  }

  const environments = await listEnvironments(project.key);
  const selectedEnvironmentKey = await readCookie(ENVIRONMENT_COOKIE);
  const environment =
    environments.find((item) => item.key === selectedEnvironmentKey) ??
    environments.find((item) => item.id === project.defaultEnvironmentId) ??
    environments.find((item) => item.isDefault) ??
    environments[0] ??
    null;

  return { projects, project, environments, environment };
});

/**
 * One project by key, for the project-scoped routes.
 *
 * Returns `null` when the project does not exist in this workspace; the API
 * answers a cross-tenant read with 404, and this maps that to the same `null`.
 */
export const findProject = cache(
  async (key: string): Promise<Project | null> => {
    try {
      return await api.projects.get(key);
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 404) return null;
      throw error;
    }
  },
);
