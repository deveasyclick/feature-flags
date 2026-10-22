/**
 * The rows one environment's SDK snapshot is assembled from.
 *
 * The shapes are flat and id-keyed because the repository fetches them as a
 * handful of set queries; the mapper groups them onto their flag afterwards.
 */

import type { MiddlewareHandler } from "hono";
import type { ApiKeyEnv } from "../../middleware/api-key.js";
import type { SdkController } from "./sdk.controller.js";

export const SDK_STREAM_INTERVAL_MS = 15_000;
export const SDK_STREAM_MAX_AGE_MS = 300_000;
export const SDK_STREAM_MAX_CONNECTIONS = 100;
export const SDK_STREAM_MAX_PER_KEY = 3;

export interface SdkRoutesDeps {
  controller: SdkController;
  apiKeyMiddleware: MiddlewareHandler<ApiKeyEnv>;
}

export interface SdkMeta {
  projectKey: string;
  projectName: string;
  environmentKey: string;
  environmentName: string;
}

/** A flag's identity joined to its configuration in the requested environment. */
export interface SdkFlagSourceRow {
  version: number;
  id: string;
  key: string;
  type: string;
  status: string;
  enabled: boolean;
  offVariationKey: string;
  defaultVariationKey: string;
  rolloutPercentage: number;
  bucketBy: string;
}

export interface SdkVariationRow {
  flagId: string;
  key: string;
  value: unknown;
}

export interface SdkRuleRow {
  id: string;
  flagId: string;
  priority: number;
  variationKey: string;
  segmentKeys: string[];
  rolloutPercentage: number | null;
  bucketBy: string | null;
}

/** A condition of a rule or of a segment; `parentId` is the owning row's id. */
export interface SdkConditionRow {
  parentId: string;
  attribute: string;
  operator: string;
  values: unknown;
  priority: number;
}

export interface SdkTargetRow {
  flagId: string;
  userId: string;
  variationKey: string;
}

export interface SdkSegmentSourceRow {
  id: string;
  key: string;
}

/** Everything the snapshot is built from, already ordered deterministically. */
export interface SdkSnapshotRows {
  flags: SdkFlagSourceRow[];
  variations: SdkVariationRow[];
  rules: SdkRuleRow[];
  ruleConditions: SdkConditionRow[];
  targets: SdkTargetRow[];
  segments: SdkSegmentSourceRow[];
  segmentConditions: SdkConditionRow[];
}

/** The SDK caches; a shared cache between the SDK and the API must not. */
export const SDK_CONFIG_CACHE_CONTROL = "no-store";
