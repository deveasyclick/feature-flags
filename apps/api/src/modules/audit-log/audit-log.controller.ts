import { auditLogQuerySchema } from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { AuditLogService } from "./audit-log.service.js";
import type { AuditLogActorContext } from "./audit-log.types.js";

export class AuditLogController {
  constructor(private readonly service: AuditLogService) {}

  async listForProject(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = auditLogQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.listForProject(
        actor,
        this.param(c, "projectKey"),
        parsed.data,
      ),
    );
  }

  async listForWorkspace(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = auditLogQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(await this.service.listForWorkspace(actor, parsed.data));
  }

  private async actor(c: Context<SessionEnv>): Promise<AuditLogActorContext> {
    const context = await requireWorkspace(c);

    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
    };
  }

  /** The router always defines these; the type does not know that. */
  private param(c: Context<SessionEnv>, name: string): string {
    const value = c.req.param(name);

    if (!value) {
      throw ApiError.badRequest(`Missing ${name} in the request path.`);
    }

    return value;
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "The audit log filters are not valid.";
  }
}
