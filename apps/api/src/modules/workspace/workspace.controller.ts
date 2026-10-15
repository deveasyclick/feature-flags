import {
  updateWorkspaceSchema,
  updateWorkspaceSecuritySchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { WorkspaceService } from "./workspace.service.js";
import type { WorkspaceActorContext } from "./workspace.types.js";

export class WorkspaceController {
  constructor(private readonly service: WorkspaceService) {}

  async getProfile(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(await this.service.getProfile(actor));
  }

  async updateProfile(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateWorkspaceSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(await this.service.updateProfile(actor, parsed.data));
  }

  async getSecurity(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(await this.service.getSecurity(actor));
  }

  async updateSecurity(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateWorkspaceSecuritySchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(await this.service.updateSecurity(actor, parsed.data));
  }

  private async actor(c: Context<SessionEnv>): Promise<WorkspaceActorContext> {
    const context = await requireWorkspace(c);

    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
    };
  }

  /** `c.req.json()` throws on malformed input, which must not become a 500. */
  private async body(c: Context<SessionEnv>): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw ApiError.badRequest("Send a valid JSON body.");
    }
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "The workspace settings are not valid.";
  }
}
