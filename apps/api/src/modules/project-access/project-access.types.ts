import type { ProjectRole } from "@iwifunni/contracts";

/** A project as the access gate needs it: identity only, never its contents. */
export interface ProjectRef {
  id: string;
  key: string;
  name: string;
}

export interface ProjectAccessGrant {
  project: ProjectRef;
  /** The caller's effective role, after the implicit-admin rule. */
  role: ProjectRole;
}

export interface RequireProjectAccessInput {
  organizationId: string;
  projectKey: string;
  userId: string;
  /** The caller's workspace role, from the session. */
  workspaceRole: string;
  minimumRole: ProjectRole;
}

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = {
  viewer: 0,
  engineer: 1,
  admin: 2,
  owner: 3,
};

export function isProjectRole(value: string | null): value is ProjectRole {
  return value !== null && value in PROJECT_ROLE_RANK;
}

export function highestRole(
  first: ProjectRole | null,
  second: ProjectRole | null,
): ProjectRole | null {
  if (!first) return second;
  if (!second) return first;

  return PROJECT_ROLE_RANK[first] >= PROJECT_ROLE_RANK[second] ? first : second;
}
