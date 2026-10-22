import type { Notification } from "@iwifunni/contracts";

export interface NotificationActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
}
export interface NotificationCursor {
  createdAt: Date;
  id: string;
}
export interface NotificationRow {
  id: string;
  action: string;
  projectName: string | null;
  createdAt: Date;
  readAt: Date | null;
}
export const NOTIFICATION_TITLES: Record<Notification["action"], string> = {
  "change_request.created": "A flag change is awaiting review",
  "change_request.approved": "A flag change was approved",
  "change_request.rejected": "A flag change was rejected",
  "flag.schedule_failed": "A scheduled change could not be applied",
  "project.archived": "A project was archived",
  "project.restored": "A project was restored",
  "project.transferred": "A project was transferred",
  "flag.automatically_rolled_back": "A flag was automatically rolled back",
};
