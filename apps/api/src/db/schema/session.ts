import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

import { user } from "./user.js";

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    /** The workspace the session is currently scoped to, once one exists. */
    activeOrganizationId: text("active_organization_id"),
    twoFactorVerifiedAt: timestamp("two_factor_verified_at", {
      withTimezone: true,
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);
