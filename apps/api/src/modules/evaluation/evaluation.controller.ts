import { evaluateRequestSchema } from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { EvaluationService } from "./evaluation.service.js";

export class EvaluationController {
  constructor(private readonly service: EvaluationService) {}

  async evaluate(c: Context<SessionEnv>): Promise<Response> {
    const context = await requireWorkspace(c);
    const parsed = evaluateRequestSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.evaluate(
        {
          organizationId: context.workspace.id,
          userId: context.user.id,
          workspaceRole: context.workspace.role,
        },
        parsed.data,
      ),
    );
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
    return issues[0]?.message ?? "That evaluation request is not valid.";
  }
}
