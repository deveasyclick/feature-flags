import type { ProjectSummary } from "@iwifunni/contracts";

import type { Transaction } from "../../shared/types/db.js";

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
}

export interface UpdateProjectRecord {
  name?: string;
  description?: string | null;
  color?: string | null;
  ownerTeam?: string | null;
  defaultEnvironmentId?: string | null;
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
