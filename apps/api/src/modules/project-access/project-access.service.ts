import type { ProjectRole } from "@iwifunni/contracts";

import { ApiError } from "../../shared/http/errors.js";
import type { ProjectAccessRepository } from "./project-access.repository.js";
import {
  highestRole,
  isProjectRole,
  PROJECT_ROLE_RANK,
  type ProjectAccessGrant,
  type RequireProjectAccessInput,
} from "./project-access.types.js";

/**
 * The single authorization gate for every project-scoped route.
 *
 * A caller who cannot see the project receives 404 and never 403, so projects
 * cannot be enumerated across tenants. Membership is resolved from the database
 * on every request rather than carried in the session, so removing somebody
 * takes effect immediately.
 */
export class ProjectAccessService {
  constructor(private readonly repository: ProjectAccessRepository) {}

  async visibleProjectIds(context: {
    organizationId: string;
    userId: string;
    workspaceRole: string;
  }): Promise<string[] | null> {
    if (this.implicitRole(context.workspaceRole)) return null;
    return this.repository.visibleProjectIds(
      context.organizationId,
      context.userId,
    );
  }

  async require(input: RequireProjectAccessInput): Promise<ProjectAccessGrant> {
    const project = await this.repository.findProjectByKey(
      input.organizationId,
      input.projectKey,
    );

    if (!project || (project.archivedAt && !input.allowArchived)) {
      throw ApiError.notFound("Project not found.");
    }

    const explicit = await this.repository.findMemberRole(
      project.id,
      input.userId,
    );

    const role = highestRole(
      this.implicitRole(input.workspaceRole),
      isProjectRole(explicit) ? explicit : null,
    );

    // Not a member at all: the project stays invisible.
    if (!role) {
      throw ApiError.notFound("Project not found.");
    }

    if (PROJECT_ROLE_RANK[role] < PROJECT_ROLE_RANK[input.minimumRole]) {
      throw ApiError.forbidden(
        "You do not have permission to do that in this project.",
      );
    }

    return { project, role };
  }

  /** A workspace owner or admin administers every project in the workspace. */
  private implicitRole(workspaceRole: string): ProjectRole | null {
    if (workspaceRole === "owner") return "owner";
    if (workspaceRole === "admin") return "admin";

    return null;
  }
}
