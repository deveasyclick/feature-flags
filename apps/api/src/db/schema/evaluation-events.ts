import {
  integer,
  doublePrecision,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { project } from "./project.js";
import { environment } from "./environments.js";

export const evaluationEvent = pgTable(
  "evaluation_events",
  {
    id: text("id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    flagKey: text("flag_key").notNull(),
    variation: text("variation").notNull(),
    reason: text("reason").notNull(),
    kind: text("kind").notNull().default("evaluation"),
    outcome: text("outcome"),
    flagVersion: integer("flag_version"),
    subjectHash: text("subject_hash"),
    latencyMs: doublePrecision("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("evaluation_event_environment_id_idx").on(
      table.environmentId,
      table.id,
    ),
    index("evaluation_event_project_time_idx").on(
      table.projectId,
      table.createdAt,
    ),
    index("evaluation_event_time_idx").on(table.createdAt),
  ],
);
