import type {
  EnvironmentDetail,
  EnvironmentSummary,
} from "@iwifunni/contracts";

import type {
  EnvironmentConnectionUrls,
  EnvironmentRow,
} from "./environments.types.js";

export function toEnvironmentSummary(
  row: EnvironmentRow,
): EnvironmentSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    key: row.key,
    name: row.name,
    description: row.description,
    color: row.color,
    isDefault: row.isDefault,
    isProtected: row.isProtected,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toEnvironmentDetail(
  row: EnvironmentRow,
  connection: EnvironmentConnectionUrls,
): EnvironmentDetail {
  return {
    ...toEnvironmentSummary(row),
    connection,
  };
}
