import type { FlagStatus, FlagType } from "@iwifunni/contracts";

import type { EnvironmentRef } from "../../shared/types/environment.js";
import type { ProjectRef } from "../project-access/index.js";

/** The environment a flag is configured in, shared with the environments module. */
export type { EnvironmentRef };

/** A flag row: identity only. What it does in an environment is a config row. */
export interface FlagRow {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string | null;
  type: string;
  tags: string[];
  owner: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One flag's state in one environment, as the list and detail reads carry it. */
export interface FlagEnvironmentSummaryRow {
  environmentKey: string;
  environmentName: string;
  enabled: boolean;
  rolloutPercentage: number;
}

/** A list row: the flag plus how it stands in every environment of its project. */
export interface FlagListRow extends FlagRow {
  environments: FlagEnvironmentSummaryRow[];
}

/** What one flag does in one environment. */
export interface FlagEnvironmentConfigRow {
  id: string;
  flagId: string;
  environmentId: string;
  enabled: boolean;
  offVariationKey: string;
  defaultVariationKey: string;
  rolloutPercentage: number;
  bucketBy: string;
}

export interface VariationRow {
  flagId: string;
  key: string;
  name: string;
  value: unknown;
  description: string | null;
  priority: number;
}

/** What stops a variation key from being removed. */
export interface VariationReference {
  environmentKey: string;
  kind: "off_variation" | "default_variation" | "rule" | "target";
  detail: string | null;
}

export interface FlagListFilter {
  search?: string;
  status?: FlagStatus;
  limit: number;
  cursor: string | null;
}

export interface WorkspaceFlagFilter {
  search?: string;
  status?: FlagStatus;
  projectKey?: string;
  limit: number;
  cursor: string | null;
}

export interface NewFlagRecord {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description: string | null;
  type: FlagType;
  tags: string[];
  owner: string | null;
}

export interface UpdateFlagRecord {
  name?: string;
  description?: string | null;
  tags?: string[];
  owner?: string | null;
}

export interface UpdateConfigRecord {
  enabled: boolean;
  offVariation: string;
  defaultVariation: string;
  rolloutPercentage: number;
  bucketBy: string;
}

export interface FlagVersionRecord {
  flagId: string;
  projectId: string;
  environmentId: string;
  version: number;
  description: string | null;
  author: string;
  snapshot: unknown;
}

export interface FlagVersionSummary {
  version: number;
  description: string | null;
  author: string;
  snapshot: unknown;
  createdAt: Date;
}

export interface TargetingRuleRow {
  id: string;
  flagId: string;
  environmentId: string;
  priority: number;
  description: string | null;
  variationKey: string;
  segmentKeys: string[];
  rolloutPercentage: number | null;
  bucketBy: string | null;
}

export interface TargetingConditionRow {
  id: string;
  ruleId: string;
  attribute: string;
  attributeType: string;
  operator: string;
  values: unknown;
  priority: number;
}

export interface RuleWithConditions {
  rule: TargetingRuleRow;
  conditions: TargetingConditionRow[];
}

export interface IndividualTargetRow {
  flagId: string;
  environmentId: string;
  userId: string;
  variationKey: string;
}

export interface DependencyRow {
  key: string;
  requires: string;
  referencedIn: string | null;
}

export interface FlagStatusRef {
  key: string;
  status: string;
}

/** What the session gate resolved, passed from the controller to the service. */
export interface FlagsActorContext {
  organizationId: string;
  workspaceRole: string;
  userId: string;
  userName: string;
}

/** The workspace-wide list orders by (project key, flag key), so its cursor holds both. */
export const WORKSPACE_FLAG_CURSOR_SEPARATOR = "::";

/** One flag in one environment, with the configuration it is read and written through. */
export interface EnvironmentScope {
  project: ProjectRef;
  flag: FlagRow;
  environment: EnvironmentRef;
  config: FlagEnvironmentConfigRow;
}

/** One flag's configuration copied out of the environment it came from. */
export interface EnvironmentConfigCopyInput {
  sourceFlagId: string;
  sourceEnvironmentId: string;
  targetEnvironmentId: string;
}
