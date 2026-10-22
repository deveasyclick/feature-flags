import {
  createProjectSchema,
  projectListQuerySchema,
  updateProjectSchema,
  duplicateProjectSchema,
  transferProjectSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { ProjectsService } from "./projects.service.js";
import type { ProjectsActorContext } from "./projects.types.js";

export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  async archive(c: Context<SessionEnv>): Promise<Response> {
    await this.service.archive(
      this.actor(await requireWorkspace(c)),
      this.param(c, "projectKey"),
    );
    return c.body(null, 204);
  }

  async restore(c: Context<SessionEnv>): Promise<Response> {
    return c.json(
      await this.service.restore(
        this.actor(await requireWorkspace(c)),
        this.param(c, "projectKey"),
      ),
    );
  }

  async duplicate(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = duplicateProjectSchema.safeParse(await this.body(c));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.duplicate(
        this.actor(context),
        this.param(c, "projectKey"),
        parsed.data,
      ),
      201,
    );
  }

  async transfer(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = transferProjectSchema.safeParse(await this.body(c));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.transfer(
        this.actor(context),
        this.param(c, "projectKey"),
        parsed.data,
      ),
      201,
    );
  }

  async list(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = projectListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(await this.service.list(this.actor(context), parsed.data));
  }

  async get(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);

    return c.json(
      await this.service.get(this.actor(context), this.param(c, "projectKey")),
    );
  }

  /** The session middleware has already resolved the context by this point. */
  async create(c: Context<SessionEnv>): Promise<Response> {
    const context = await this.requireWorkspace(c);

    const parsed = createProjectSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.create(this.actor(context), parsed.data);

    return c.json(created, 201);
  }

  async update(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = updateProjectSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.update(
        this.actor(context),
        this.param(c, "projectKey"),
        parsed.data,
      ),
    );
  }

  private actor(
    context: Awaited<ReturnType<typeof requireWorkspace>>,
  ): ProjectsActorContext {
    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
      userName: context.user.name,
    };
  }

  private requireWorkspace(c: Context<SessionEnv>) {
    return requireWorkspace(c);
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
    return issues[0]?.message ?? "The project details are not valid.";
  }
}
