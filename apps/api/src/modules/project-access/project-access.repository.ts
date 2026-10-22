import { and, eq, inArray } from "drizzle-orm";

import { db } from "../../db/client.js";
import { project, projectMember } from "../../db/schema/index.js";
import type { ProjectRef } from "./project-access.types.js";

export class ProjectAccessRepository {
  async visibleProjectIds(
    organizationId: string,
    userId: string,
  ): Promise<string[]> {
    const rows = await db
      .select({ id: project.id })
      .from(project)
      .innerJoin(projectMember, eq(projectMember.projectId, project.id))
      .where(
        and(
          eq(project.organizationId, organizationId),
          eq(projectMember.userId, userId),
          inArray(projectMember.role, ["owner", "admin", "engineer", "viewer"]),
        ),
      );
    return rows.map((row) => row.id);
  }

  /**
   * Runs outside a caller's transaction: the gate answers before the mutation
   * opens one, and the workspace scope is applied here rather than by a caller.
   */
  async findProjectByKey(
    organizationId: string,
    key: string,
  ): Promise<ProjectRef | null> {
    const rows = await db
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
        archivedAt: project.archivedAt,
      })
      .from(project)
      .where(
        and(eq(project.organizationId, organizationId), eq(project.key, key)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /** The explicit project membership, if any. Workspace roles are implicit. */
  async findMemberRole(
    projectId: string,
    userId: string,
  ): Promise<string | null> {
    const rows = await db
      .select({ role: projectMember.role })
      .from(projectMember)
      .where(
        and(
          eq(projectMember.projectId, projectId),
          eq(projectMember.userId, userId),
        ),
      )
      .limit(1);

    return rows[0]?.role ?? null;
  }
}
