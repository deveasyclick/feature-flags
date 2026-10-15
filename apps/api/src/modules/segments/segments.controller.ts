import {
  createSegmentSchema,
  segmentListQuerySchema,
  updateSegmentSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { SegmentsService } from "./segments.service.js";
import type { SegmentActorContext } from "./segments.types.js";

export class SegmentsController {
  constructor(private readonly service: SegmentsService) {}

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = segmentListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.list(actor, this.param(c, "projectKey"), parsed.data),
    );
  }

  async create(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createSegmentSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.create(
      actor,
      this.param(c, "projectKey"),
      parsed.data,
    );

    return c.json(created, 201);
  }

  async get(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.get(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "segmentKey"),
      ),
    );
  }

  async update(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateSegmentSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.update(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "segmentKey"),
        parsed.data,
      ),
    );
  }

  async archive(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.archive(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "segmentKey"),
      ),
    );
  }

  async listFlags(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.listFlags(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "segmentKey"),
      ),
    );
  }

  private async actor(c: Context<SessionEnv>): Promise<SegmentActorContext> {
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
    return issues[0]?.message ?? "The segment details are not valid.";
  }
}
