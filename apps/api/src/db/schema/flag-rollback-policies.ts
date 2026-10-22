import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organization } from "./organization.js";
import { project } from "./project.js";
import { flag } from "./flags.js";
import { environment } from "./environments.js";

export const flagRollbackPolicy = pgTable(
  "flag_rollback_policies",
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
    createdBy: text("created_by").notNull(),
    currentVersion: integer("current_version").notNull(),
    targetVersion: integer("target_version").notNull(),
    errorPercentage: doublePrecision("error_percentage").notNull(),
    minimumSamples: integer("minimum_samples").notNull(),
    windowMinutes: integer("window_minutes").notNull(),
    status: text("status").notNull().default("armed"),
    armedAt: timestamp("armed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (table) => [
    index("flag_rollback_due_idx").on(table.status, table.checkedAt),
    uniqueIndex("flag_rollback_armed_idx")
      .on(table.flagId, table.environmentId)
      .where(sql`${table.status} = 'armed'`),
  ],
);
