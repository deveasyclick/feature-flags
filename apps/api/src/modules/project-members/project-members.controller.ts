import {
  addProjectMemberSchema,
  updateProjectMemberSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { ProjectMembersService } from "./project-members.service.js";
import type { ProjectMemberActorContext } from "./project-members.types.js";

export class ProjectMembersController {
  constructor(private readonly service: ProjectMembersService) {}

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.list(actor, this.param(c, "projectKey")),
    );
  }

  async add(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = addProjectMemberSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.add(
      actor,
      this.param(c, "projectKey"),
      parsed.data,
    );

    return c.json(created, 201);
  }

  async updateRole(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateProjectMemberSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateRole(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "userId"),
        parsed.data,
      ),
    );
  }

  async remove(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.remove(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "userId"),
      ),
    );
  }

  private async actor(c: Context<SessionEnv>): Promise<ProjectMemberActorContext> {
    const context = await requireWorkspace(c);

    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
      userName: context.user.name,
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

  /** `c.req.json()` throws on malformed input, which must not become a 500. */
  private async body(c: Context<SessionEnv>): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw ApiError.badRequest("Send a valid JSON body.");
    }
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "Those membership details are not valid.";
  }
}
