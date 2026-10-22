import { eq, and, ne } from "drizzle-orm";

import { db } from "../../db/client.js";
import { member, organization, session } from "../../db/schema/index.js";
import { sessionTimeoutSchema } from "@iwifunni/contracts";
import { SESSION_MAX_AGES } from "./auth.types.js";
import type { WorkspaceMembership } from "./auth.types.js";

export class AuthRepository {
  async findWorkspaceForUser(
    userId: string,
    activeOrganizationId?: string | null,
  ): Promise<WorkspaceMembership | null> {
    let rows = await this.selectWorkspace(userId, activeOrganizationId);
    if (!rows.length && activeOrganizationId)
      rows = await this.selectWorkspace(userId);

    const row = rows[0];
    if (!row) return null;
    let timeout = sessionTimeoutSchema.parse("24h");
    let requireTwoFactor = false;
    try {
      const metadata: unknown = JSON.parse(row.metadata ?? "{}");
      if (metadata && typeof metadata === "object" && "security" in metadata) {
        const security = metadata.security;
        if (
          security &&
          typeof security === "object" &&
          "twoFactorEnabled" in security
        )
          requireTwoFactor = security.twoFactorEnabled === true;
        if (
          security &&
          typeof security === "object" &&
          "sessionTimeout" in security
        ) {
          const parsed = sessionTimeoutSchema.safeParse(
            security.sessionTimeout,
          );
          if (parsed.success) timeout = parsed.data;
        }
      }
    } catch {}
    const { metadata: _metadata, ...workspace } = row;
    return {
      ...workspace,
      sessionMaxAgeMs: SESSION_MAX_AGES[timeout],
      requireTwoFactor,
    };
  }

  async verifySessionFactor(id: string, userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .update(session)
        .set({ twoFactorVerifiedAt: new Date() })
        .where(and(eq(session.id, id), eq(session.userId, userId)));
      await tx
        .delete(session)
        .where(and(eq(session.userId, userId), ne(session.id, id)));
    });
  }

  async revokeSession(id: string): Promise<void> {
    await db.delete(session).where(eq(session.id, id));
  }

  private async selectWorkspace(
    userId: string,
    organizationId?: string | null,
  ) {
    return db
      .select({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        role: member.role,
        metadata: organization.metadata,
      })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, userId),
          organizationId ? eq(organization.id, organizationId) : undefined,
        ),
      )
      .limit(1);
  }
}
