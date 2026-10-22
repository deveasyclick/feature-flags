import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organization } from "./organization.js";

export const project = pgTable(
  "project",
  {
    id: text("id").primaryKey(),
    /** Tenant key. Every project query is scoped by this. */
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // Slug used in API paths, e.g. `checkout-platform`. Unique per workspace, not
    // globally: two tenants may both have a project called `web-app`.
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    ownerTeam: text("owner_team"),
    defaultEnvironmentId: text("default_environment_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("project_organization_key_idx").on(
      table.organizationId,
      table.key,
    ),
    index("project_organization_id_idx").on(table.organizationId),
  ],
);
