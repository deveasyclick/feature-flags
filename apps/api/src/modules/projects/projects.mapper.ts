import type { Project } from "@iwifunni/contracts";

import type { ProjectDetailRow } from "./projects.types.js";

export function toProject(row: ProjectDetailRow): Project {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    color: row.color,
    ownerTeam: row.ownerTeam,
    defaultEnvironmentId: row.defaultEnvironmentId,
    environmentCount: row.environmentCount,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
