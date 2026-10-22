import {
  analyticsQuerySchema,
  evaluationEventBatchSchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";
import { requireWorkspace } from "../../middleware/authorization.js";
import { requireApiKey, type ApiKeyEnv } from "../../middleware/api-key.js";
import type { SessionEnv } from "../auth/index.js";
import { ApiError } from "../../shared/http/errors.js";
import type { AnalyticsService } from "./analytics.service.js";

export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}
  async ingest(c: Context<ApiKeyEnv>): Promise<Response> {
    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      throw ApiError.badRequest("Invalid JSON body.");
    }
    const parsed = evaluationEventBatchSchema.safeParse(body);
    if (!parsed.success)
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Invalid evaluation events.",
      );
    return c.json(
      await this.service.ingest(requireApiKey(c), parsed.data),
      202,
    );
  }
  async summary(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = analyticsQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Invalid analytics query.",
      );
    c.header("Cache-Control", "no-store");
    return c.json(
      await this.service.summary(
        {
          organizationId: context.workspace.id,
          workspaceRole: context.workspace.role,
          userId: context.user.id,
        },
        parsed.data,
      ),
    );
  }
}
