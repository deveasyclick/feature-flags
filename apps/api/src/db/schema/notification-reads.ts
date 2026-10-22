import { pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";
import { user } from "./user.js";
import { auditLog } from "./audit-log.js";

export const notificationRead = pgTable(
  "notification_reads",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    auditId: text("audit_id")
      .notNull()
      .references(() => auditLog.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.auditId] })],
);
