import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { project } from "./project.js";

// The flag's identity. What it does in one environment is a
// `flag_environment_configs` row, and the keys it can serve are `flag_variations`.
export const flag = pgTable(
  "flags",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => project.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    type: text("type").notNull().default("boolean"),
    tags: text("tags").array().notNull().default([]),
    owner: text("owner"),
    status: text("status").notNull().default("active"),
    clientVisible: boolean("client_visible").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("flag_project_key_idx").on(table.projectId, table.key),
    index("flag_project_id_idx").on(table.projectId),
    index("flag_status_idx").on(table.status),
  ],
);
