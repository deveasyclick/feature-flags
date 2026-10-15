import type { Theme, UserPreferences } from "@iwifunni/contracts";

import type { PreferencesRow } from "./account.types.js";

export function toUserPreferences(row: PreferencesRow): UserPreferences {
  return {
    theme: row.theme as Theme,
    defaultProjectId: row.defaultProjectId,
    defaultEnvironmentId: row.defaultEnvironmentId,
    notifications: {
      flagChanges: row.notifyOnFlagChange,
      weeklyDigest: row.notifyWeeklyDigest,
      incidentAlerts: row.notifyIncidentAlerts,
    },
  };
}
