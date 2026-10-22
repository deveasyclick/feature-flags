import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import type { AnalyticsSummary } from "@iwifunni/contracts";
import { db } from "../../db/client.js";
import {
  evaluationEvent,
  project,
  environment,
} from "../../db/schema/index.js";
import type { NewEvaluationEvent } from "./analytics.types.js";

export class AnalyticsRepository {
  async insert(events: NewEvaluationEvent[]): Promise<number> {
    if (!events.length) return 0;
    const rows = await db
      .insert(evaluationEvent)
      .values(events)
      .onConflictDoNothing()
      .returning({ id: evaluationEvent.id });
    return rows.length;
  }

  async summary(
    organizationId: string,
    projectIds: string[] | null,
    days: number,
    since: Date,
  ): Promise<AnalyticsSummary> {
    const scope = and(
      eq(project.organizationId, organizationId),
      eq(evaluationEvent.kind, "evaluation"),
      gte(evaluationEvent.createdAt, since),
      projectIds ? inArray(project.id, projectIds) : undefined,
    );
    const [totals] = await db
      .select({
        evaluations: sql<number>`count(*)::int`,
        users: sql<number>`count(distinct ${evaluationEvent.subjectHash})::int`,
        errors: sql<number>`count(*) filter (where ${evaluationEvent.reason} = 'error')::int`,
        avgLatencyMs: sql<number>`coalesce(avg(${evaluationEvent.latencyMs}), 0)::float8`,
        p95LatencyMs: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${evaluationEvent.latencyMs}), 0)::float8`,
      })
      .from(evaluationEvent)
      .innerJoin(project, eq(project.id, evaluationEvent.projectId))
      .where(scope);
    const daily = await db
      .select({
        date: sql<string>`to_char(${evaluationEvent.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`.as(
          "date",
        ),
        evaluations: sql<number>`count(*)::int`,
      })
      .from(evaluationEvent)
      .innerJoin(project, eq(project.id, evaluationEvent.projectId))
      .where(scope)
      .groupBy(
        sql`to_char(${evaluationEvent.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
      )
      .orderBy(sql`date`);
    const topFlags = await db
      .select({
        flagKey: evaluationEvent.flagKey,
        projectKey: project.key,
        evaluations: sql<number>`count(*)::int`,
      })
      .from(evaluationEvent)
      .innerJoin(project, eq(project.id, evaluationEvent.projectId))
      .where(scope)
      .groupBy(evaluationEvent.flagKey, project.key)
      .orderBy(sql`count(*) desc`)
      .limit(10);
    const environments = await db
      .select({
        environmentKey: environment.key,
        evaluations: sql<number>`count(*)::int`,
      })
      .from(evaluationEvent)
      .innerJoin(project, eq(project.id, evaluationEvent.projectId))
      .innerJoin(environment, eq(environment.id, evaluationEvent.environmentId))
      .where(scope)
      .groupBy(environment.key)
      .orderBy(sql`count(*) desc`);
    return {
      days,
      evaluations: totals?.evaluations ?? 0,
      users: totals?.users ?? 0,
      errors: totals?.errors ?? 0,
      avgLatencyMs: totals?.avgLatencyMs ?? 0,
      p95LatencyMs: totals?.p95LatencyMs ?? 0,
      daily,
      topFlags,
      environments,
    };
  }

  async deleteExpired(before: Date): Promise<void> {
    await db
      .delete(evaluationEvent)
      .where(lt(evaluationEvent.createdAt, before));
  }
}
