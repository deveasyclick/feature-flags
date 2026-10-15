import {
  apiKeyListQuerySchema,
  createApiKeySchema,
  updateApiKeySchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { ApiKeysService } from "./api-keys.service.js";
import type { ApiKeyActorContext } from "./api-keys.types.js";

export class ApiKeysController {
  constructor(private readonly service: ApiKeysService) {}

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = apiKeyListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.list(actor, this.param(c, "projectKey"), parsed.data),
    );
  }

  async create(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createApiKeySchema.safeParse(await this.body(c));

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

  async rename(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateApiKeySchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.rename(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "keyId"),
        parsed.data,
      ),
    );
  }

  /** The reply carries the new secret; it is the only one that ever does again. */
  async rotate(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.rotate(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "keyId"),
      ),
    );
  }

  async revoke(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.revoke(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "keyId"),
      ),
    );
  }

  private async actor(c: Context<SessionEnv>): Promise<ApiKeyActorContext> {
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
    return issues[0]?.message ?? "The API key details are not valid.";
  }
}
