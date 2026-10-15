import {
  createEnvironmentSchema,
  environmentListQuerySchema,
  updateEnvironmentSchema,
  updateEnvironmentSettingsSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { EnvironmentsService } from "./environments.service.js";
import type { EnvironmentActorContext } from "./environments.types.js";

export class EnvironmentsController {
  constructor(private readonly service: EnvironmentsService) {}

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = environmentListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.list(
        actor,
        this.param(c, "projectKey"),
        parsed.data.limit,
        parsed.data.cursor,
        parsed.data.includeArchived ?? false,
      ),
    );
  }

  async create(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createEnvironmentSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.create(
      actor,
      this.param(c, "projectKey"),
      parsed.data,
      this.origin(c),
    );

    return c.json(created, 201);
  }

  async get(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.get(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "environmentKey"),
        this.origin(c),
      ),
    );
  }

  async updateSettings(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateEnvironmentSettingsSchema.safeParse(
      await this.body(c),
    );

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateSettings(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "environmentKey"),
        parsed.data,
        this.origin(c),
      ),
    );
  }

  async update(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateEnvironmentSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.update(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "environmentKey"),
        parsed.data,
        this.origin(c),
      ),
    );
  }

  async archive(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.archive(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "environmentKey"),
        this.origin(c),
      ),
    );
  }

  async unarchive(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.unarchive(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "environmentKey"),
        this.origin(c),
      ),
    );
  }


  private async actor(
    c: Context<SessionEnv>,
  ): Promise<EnvironmentActorContext> {
    const context = await requireWorkspace(c);

    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
      userName: context.user.name,
    };
  }

  /** The API's own origin, which is what an SDK points at. */
  private origin(c: Context<SessionEnv>): string {
    return new URL(c.req.url).origin;
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
    return issues[0]?.message ?? "The environment details are not valid.";
  }
}
