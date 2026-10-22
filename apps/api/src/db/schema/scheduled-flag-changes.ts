import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

import { organization } from "./organization.js";
import { project } from "./project.js";
import { flag } from "./flags.js";
import { environment } from "./environments.js";

export const scheduledFlagChange = pgTable(
  "scheduled_flag_changes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    flagId: text("flag_id")
      .notNull()
      .references(() => flag.id, { onDelete: "cascade" }),
    environmentId: text("environment_id")
      .notNull()
      .references(() => environment.id, { onDelete: "cascade" }),
    executeAt: timestamp("execute_at", { withTimezone: true }).notNull(),
    baseVersion: integer("base_version").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull().default("pending"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    failureReason: text("failure_reason"),
  },
  (table) => [
    index("scheduled_flag_change_due_idx").on(table.status, table.executeAt),
    index("scheduled_flag_change_environment_idx").on(
      table.flagId,
      table.environmentId,
      table.createdAt,
    ),
  ],
);
