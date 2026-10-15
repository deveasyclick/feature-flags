import type { SessionTimeout, Theme } from "@iwifunni/contracts";

export type WorkspaceTheme = Theme;

export const settingsDescription =
  "Manage your workspace, team access, and developer configuration.";

export const workspaceHost = "flags.iwifunni.cc";

export function workspaceUrl(slug: string): string {
  return `${workspaceHost}/${slug}`;
}

export const themeOptions: Array<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export const timezoneOptions: readonly string[] = [
  "(GMT+0) London",
  "(GMT+1) Lagos",
  "(GMT+1) Berlin",
  "(GMT+2) Johannesburg",
  "(GMT-5) New York",
  "(GMT-8) Los Angeles",
];

/** Keeps a stored timezone selectable when it is not one of the presets. */
export function timezoneChoices(current: string): readonly string[] {
  if (!current || timezoneOptions.includes(current)) return timezoneOptions;
  return [current, ...timezoneOptions];
}

export const sessionTimeoutOptions: Array<{
  value: SessionTimeout;
  label: string;
}> = [
  { value: "1h", label: "1 hour" },
  { value: "12h", label: "12 hours" },
  { value: "24h", label: "24 hours" },
  { value: "7d", label: "7 days" },
];

export const auditRetentionOptions: Array<{ value: number; label: string }> = [
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
];

export type IntegrationGlyph =
  | "slack"
  | "github"
  | "datadog"
  | "pagerduty"
  | "jira"
  | "segment";

export type IntegrationTone = "primary" | "purple" | "green" | "info" | "slate";

export interface IntegrationApp {
  key: string;
  name: string;
  description: string;
  glyph: IntegrationGlyph;
  tone: IntegrationTone;
}

export const integrations: IntegrationApp[] = [
  {
    key: "slack",
    name: "Slack",
    description: "Flag changes in your channels.",
    glyph: "slack",
    tone: "purple",
  },
  {
    key: "github",
    name: "GitHub",
    description: "Link flags to pull requests.",
    glyph: "github",
    tone: "slate",
  },
  {
    key: "datadog",
    name: "Datadog",
    description: "Forward evaluation metrics.",
    glyph: "datadog",
    tone: "purple",
  },
  {
    key: "pagerduty",
    name: "PagerDuty",
    description: "Page on rollout incidents.",
    glyph: "pagerduty",
    tone: "green",
  },
  {
    key: "jira",
    name: "Jira",
    description: "Sync rollout tasks.",
    glyph: "jira",
    tone: "info",
  },
  {
    key: "segment",
    name: "Segment",
    description: "Stream flag exposures.",
    glyph: "segment",
    tone: "primary",
  },
];
