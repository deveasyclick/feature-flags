import type {
  WorkspaceProfile,
  WorkspaceSecuritySettings,
} from "@iwifunni/contracts";

export interface WorkspaceRow {
  id: string;
  name: string;
  slug: string;
  metadata: string | null;
}

/** What Iwifunni stores in the organization's free-form metadata column. */
export interface WorkspaceMetadata {
  defaultEnvironmentId?: string | null;
  timezone?: string;
  security?: Partial<WorkspaceSecuritySettings>;
}

export interface EnvironmentRef {
  id: string;
  key: string;
}

export interface WorkspaceActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
}

export const DEFAULT_TIMEZONE = "UTC";

export const DEFAULT_SECURITY_SETTINGS: WorkspaceSecuritySettings = {
  ssoProvider: null,
  ssoConnected: false,
  twoFactorEnabled: false,
  sessionTimeout: "24h",
  allowedEmailDomains: [],
  ipAllowlistConfigured: false,
  auditRetentionDays: 90,
};

export interface WorkspaceProfileResult {
  profile: WorkspaceProfile;
  metadata: WorkspaceMetadata;
}
