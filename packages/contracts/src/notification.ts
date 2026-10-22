import { z } from "zod";
import { paginationQuerySchema } from "#pagination";

export const NOTIFICATION_ACTIONS = ["change_request.created", "change_request.approved", "change_request.rejected", "flag.schedule_failed", "project.archived", "project.restored", "project.transferred", "flag.automatically_rolled_back"] as const;
export const notificationActionSchema = z.enum(NOTIFICATION_ACTIONS);
export const notificationSchema = z.object({ id: z.string().uuid(), action: notificationActionSchema, title: z.string(), projectName: z.string().nullable(), createdAt: z.string(), read: z.boolean(), href: z.string() });
export type Notification = z.infer<typeof notificationSchema>;
export const notificationListQuerySchema = paginationQuerySchema;
export const notificationIdSchema = z.string().uuid();
export const notificationCursorSchema = z.object({ createdAt: z.iso.datetime(), id: z.string().uuid() });
export const notificationPageSchema = z.object({ data: z.array(notificationSchema), nextCursor: z.string().nullable(), unreadCount: z.number().int().nonnegative() });
export type NotificationPage = z.infer<typeof notificationPageSchema>;
