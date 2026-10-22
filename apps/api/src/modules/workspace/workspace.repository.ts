import { and, eq } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
  environment,
  organization,
  project,
  user,
} from "../../db/schema/index.js";
import type { EnvironmentRef, WorkspaceRow } from "./workspace.types.js";

export class WorkspaceRepository {
  async hasTwoFactor(userId: string): Promise<boolean> {
    const [row] = await db
      .select({ enabled: user.twoFactorEnabled })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    return row?.enabled ?? false;
  }
  async updateProfile(
    id: string,
    metadata: string,
    name?: string,
  ): Promise<void> {
    await db
      .update(organization)
      .set({ metadata, ...(name === undefined ? {} : { name }) })
      .where(eq(organization.id, id));
  }

  async findById(organizationId: string): Promise<WorkspaceRow | null> {
    const rows = await db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        metadata: organization.metadata,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1);

    return rows[0] ?? null;
  }

  async updateName(id: string, name: string): Promise<void> {
    await db.update(organization).set({ name }).where(eq(organization.id, id));
  }

  /**
   * Better Auth owns the `organization` table and never touches this column
   * beyond carrying it, so workspace settings live inside its JSON.
   */
  async updateMetadata(id: string, metadata: string): Promise<void> {
    await db
      .update(organization)
      .set({ metadata })
      .where(eq(organization.id, id));
  }

  async findEnvironmentByKey(
    organizationId: string,
    key: string,
  ): Promise<EnvironmentRef | null> {
    const rows = await db
      .select({ id: environment.id, key: environment.key })
      .from(environment)
      .innerJoin(project, eq(project.id, environment.projectId))
      .where(
        and(
          eq(project.organizationId, organizationId),
          eq(environment.key, key),
        ),
      )
      .orderBy(environment.key)
      .limit(1);

    return rows[0] ?? null;
  }
}
