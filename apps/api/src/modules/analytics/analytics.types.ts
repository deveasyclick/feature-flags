import type { evaluationEvent } from "../../db/schema/index.js";
export type NewEvaluationEvent = typeof evaluationEvent.$inferInsert;
export interface AnalyticsActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
}
