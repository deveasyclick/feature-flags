import type { Theme } from "@iwifunni/contracts";
import type { MiddlewareHandler } from "hono";
import type { AccountController } from "./account.controller.js";

export interface AccountRoutesDeps {
  controller: AccountController;
  sessionMiddleware: MiddlewareHandler;
}

export interface PreferencesRow {
  userId: string;
  defaultProjectId: string | null;
  theme: string;
  defaultEnvironmentId: string | null;
  notifyOnFlagChange: boolean;
  notifyOnRolloutComplete: boolean;
  notifyWeeklyDigest: boolean;
  notifyIncidentAlerts: boolean;
}

/** Only the keys the caller actually changed reach the upsert. */
export interface PreferencesPatch {
  theme?: Theme;
  defaultEnvironmentId?: string | null;
  notifyOnFlagChange?: boolean;
  notifyWeeklyDigest?: boolean;
  notifyIncidentAlerts?: boolean;
}

export interface EnvironmentRef {
  id: string;
  key: string;
}
