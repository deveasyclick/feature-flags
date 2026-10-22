import { createHmac } from "node:crypto";
import type {
  AnalyticsQuery,
  AnalyticsSummary,
  EvaluationEventBatch,
} from "@iwifunni/contracts";
import { env } from "../../config/index.js";
import { ApiError } from "../../shared/http/errors.js";
import type { ApiKeyAccessContext } from "../api-keys/index.js";
import type { ProjectAccessService } from "../project-access/index.js";
import type { AnalyticsRepository } from "./analytics.repository.js";
import type { AnalyticsActorContext } from "./analytics.types.js";

export class AnalyticsService {
  constructor(
    private readonly repository: AnalyticsRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}
  async ingest(
    access: ApiKeyAccessContext,
    input: EvaluationEventBatch,
  ): Promise<{ accepted: number }> {
    if (
      access.kind !== "server" ||
      !access.environmentId ||
      !access.scopes.includes("events:write")
    )
      throw ApiError.forbidden(
        "An environment-scoped server key with events:write is required.",
      );
    const environmentId = access.environmentId;
    const accepted = await this.repository.insert(
      input.events.map((event) => ({
        id: event.id,
        projectId: access.projectId,
        environmentId,
        flagKey: event.flagKey,
        variation: event.variation,
        reason: event.reason,
        kind: event.kind,
        outcome: event.outcome,
        flagVersion: event.flagVersion,
        latencyMs: event.latencyMs,
        subjectHash: event.userId
          ? createHmac("sha256", env.betterAuthSecret)
              .update(`${environmentId}:${event.userId}`)
              .digest("hex")
          : null,
      })),
    );
    return { accepted };
  }
  async summary(
    context: AnalyticsActorContext,
    input: AnalyticsQuery,
  ): Promise<AnalyticsSummary> {
    const ids = input.projectKey
      ? [
          (
            await this.projectAccess.require({
              ...context,
              projectKey: input.projectKey,
              minimumRole: "viewer",
            })
          ).project.id,
        ]
      : await this.projectAccess.visibleProjectIds(context);
    return this.repository.summary(
      context.organizationId,
      ids,
      input.days,
      new Date(Date.now() - input.days * 86_400_000),
    );
  }
  async retain(): Promise<void> {
    await this.repository.deleteExpired(new Date(Date.now() - 90 * 86_400_000));
  }
}
