import type { ProjectSummary } from "@iwifunni/contracts";

import type { Transaction } from "../../shared/types/db.js";
import type { MiddlewareHandler } from "hono";
import type { ProjectsController } from "./projects.controller.js";
export interface ProjectsRoutesDeps {
  controller: ProjectsController;
  sessionMiddleware: MiddlewareHandler;
}

export type ProjectRow = ProjectSummary;

export type StarterEnvironmentsCreator = (
  tx: Transaction,
  projectId: string,
) => Promise<void>;

export interface NewProject {
  id: string;
  organizationId: string;
  key: string;
  name: string;
}

/** The list/detail shape: the project plus how many environments it has. */
export interface ProjectDetailRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  ownerTeam: string | null;
  defaultEnvironmentId: string | null;
  environmentCount: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

export interface UpdateProjectRecord {
  name?: string;
  description?: string | null;
  color?: string | null;
  ownerTeam?: string | null;
  defaultEnvironmentId?: string | null;
  archivedAt?: Date | null;
}

export interface ProjectsActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
  userName: string;
}

export interface EnvironmentRef {
  id: string;
  key: string;
}
