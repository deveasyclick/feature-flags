import {
  createFlagChangeRequestSchema,
  decideFlagChangeRequestSchema,
  flagChangeRequestListQuerySchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { ChangeRequestsService } from "./change-requests.service.js";
import type { ChangeRequestActorContext } from "./change-requests.types.js";

export class ChangeRequestsController {
  constructor(private readonly service: ChangeRequestsService) {}

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = flagChangeRequestListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.list(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        parsed.data,
      ),
    );
  }

  async create(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createFlagChangeRequestSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.create(
      actor,
      this.param(c, "projectKey"),
      this.param(c, "flagKey"),
      parsed.data,
    );

    return c.json(created, 201);
  }

  async approve(c: Context<SessionEnv>): Promise<Response> {
    return this.decide(c, "approve");
  }

  async reject(c: Context<SessionEnv>): Promise<Response> {
    return this.decide(c, "reject");
  }

  private async decide(
    c: Context<SessionEnv>,
    decision: "approve" | "reject",
  ): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = decideFlagChangeRequestSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const projectKey = this.param(c, "projectKey");
    const flagKey = this.param(c, "flagKey");
    const requestId = this.param(c, "requestId");

    if (decision === "approve") {
      return c.json(
        await this.service.approve(
          actor,
          projectKey,
          flagKey,
          requestId,
          parsed.data,
        ),
      );
    }

    return c.json(
      await this.service.reject(
        actor,
        projectKey,
        flagKey,
        requestId,
        parsed.data,
      ),
    );
  }

  private async actor(
    c: Context<SessionEnv>,
  ): Promise<ChangeRequestActorContext> {
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

  /** A decision note is optional, so an empty body is a decision with no note. */
  private async body(c: Context<SessionEnv>): Promise<unknown> {
    const raw = await c.req.text();

    if (raw.trim().length === 0) return {};

    try {
      return JSON.parse(raw);
    } catch {
      throw ApiError.badRequest("Send a valid JSON body.");
    }
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "The change request is not valid.";
  }
}
