import type {
  AddProjectMemberInput,
  ApiKey,
  ApiKeyListQuery,
  AuditLogEntry,
  AuditLogQuery,
  ChangePasswordInput,
  CreateApiKeyInput,
  CreateEnvironmentInput,
  CreateFlagInput,
  CreateFlagVariationInput,
  CreateSegmentInput,
  CreatedApiKey,
  EnvironmentDetail,
  EnvironmentListQuery,
  EnvironmentSummary,
  EvaluateRequest,
  EvaluationResult,
  CreateFlagChangeRequestInput,
  DecideFlagChangeRequestInput,
  FlagChangeRequest,
  FlagChangeRequestListQuery,
  FlagDependencyGraph,
  FlagDetail,
  FlagEnvironmentConfig,
  FlagIndividualTarget,
  FlagListQuery,
  FlagSummary,
  FlagVariation,
  FlagVersion,
  PaginationQuery,
  Project,
  ProjectMember,
  ReplaceIndividualTargetsInput,
  ReplaceTargetingRulesInput,
  SegmentDetail,
  SegmentFlag,
  SegmentListQuery,
  SegmentSummary,
  SessionUser,
  TargetingRule,
  UpdateApiKeyInput,
  UpdateEnvironmentInput,
  UpdateEnvironmentSettingsInput,
  UpdateFlagConfigInput,
  UpdateFlagInput,
  UpdateFlagVariationInput,
  UpdateNotificationsInput,
  UpdatePreferencesInput,
  UpdateProfileInput,
  UpdateProjectInput,
  UpdateSegmentInput,
  UpdateWorkspaceInput,
  UpdateWorkspaceSecurityInput,
  UserPreferences,
  WorkspaceFlagListQuery,
  WorkspaceFlagSummary,
  WorkspaceProfile,
  WorkspaceSecuritySettings,
} from "@dariise/contracts";
import env from "shared/env";

/**
 * Thin typed client for the Dariise API. It intentionally has no data-fetching
 * framework attached: Server Components call the resource functions directly,
 * and Client Components can call them for mutations.
 *
 * Types come from `@dariise/contracts`, so this file cannot drift from the wire
 * contract the API validates against.
 */

export class ApiError extends Error {
  readonly status: number;
  /** The envelope's `error.code`, e.g. `approval_required`. */
  readonly code: string | null;
  readonly details: unknown;

  constructor(
    message: string,
    status: number,
    code: string | null = null,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** The envelope's `error.code`, when the response carried one. */
function errorCode(payload: unknown): string | null {
  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      typeof (error as { code: unknown }).code === "string"
    ) {
      return (error as { code: string }).code;
    }
  }

  return null;
}

/**
 * Query parameters are stringified before being sent, so any serialisable
 * value is accepted. `undefined` and `null` entries are dropped.
 */
export type QueryParams = Record<string, unknown>;

/** Mirrors the `{ data, nextCursor }` envelope every list endpoint returns. */
export interface ApiPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface RequestOptions {
  /**
   * Seconds a Server Component may reuse the response for. Omit to opt out of
   * caching, which is the right default for configuration that changes.
   */
  revalidate?: number;
  /** Set for non-GET requests. */
  body?: unknown;
  signal?: AbortSignal;
  /** Extra headers, e.g. the forwarded session cookie. */
  headers?: Record<string, string>;
}

export type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

/** True in a Server Component, a Server Action or a route handler. */
function isServer(): boolean {
  return typeof window === "undefined";
}

/**
 * Whether a rejected `fetch` was the caller aborting it.
 *
 * An abort is the caller's own doing — a superseded request, an unmounted
 * component — so it is passed through rather than reported as a failure. The
 * dashboard's forms test for it by name.
 */
function isAbort(cause: unknown): boolean {
  return (cause as { name?: unknown } | null)?.name === "AbortError";
}

/**
 * The origin to reach the API from.
 *
 * The browser uses the public URL; the server uses the internal one, which may
 * be a private address the browser cannot resolve.
 */
function apiBaseUrl(): string {
  return isServer() ? env.apiInternalUrl : env.apiUrl;
}

/**
 * The incoming request's cookies, forwarded to the API.
 *
 * The API is the only party that can validate the session cookie, and a Server
 * Component's `fetch` does not carry the browser's headers on its own. Returns
 * `null` outside a request scope, e.g. while collecting page data at build time.
 */
async function forwardedCookies(): Promise<string | null> {
  if (!isServer()) return null;

  const { cookies } = await import("next/headers");

  try {
    return (await cookies()).toString() || null;
  } catch {
    return null;
  }
}

function buildUrl(path: string, query?: QueryParams): string {
  const url = new URL(`${apiBaseUrl()}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/** Reads the contracted `{ error: { code, message, details? } }` envelope. */
function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload.trim()) return payload;

  if (payload && typeof payload === "object" && "error" in payload) {
    const error = (payload as { error: unknown }).error;

    if (
      error &&
      typeof error === "object" &&
      "message" in error &&
      typeof (error as { message: unknown }).message === "string"
    ) {
      return (error as { message: string }).message;
    }
  }

  return `Dariise API request failed with status ${status}`;
}

/**
 * Perform a request against the Dariise API and parse the JSON response.
 *
 * @throws {ApiError} when the API responds with a non-2xx status.
 */
export async function request<T>(
  method: HttpMethod,
  path: string,
  options: RequestOptions & { query?: QueryParams } = {},
): Promise<T> {
  const { query, body, revalidate, signal, headers } = options;

  const server = isServer();
  const cookieHeader = server ? await forwardedCookies() : null;

  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(cookieHeader === null ? {} : { cookie: cookieHeader }),
        ...headers,
      },
      // The dashboard and the API are separate origins; a browser request only
      // carries the session cookie when it opts in.
      ...(server ? {} : { credentials: "include" as const }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
      ...(revalidate === undefined
        ? { cache: "no-store" as const }
        : { next: { revalidate } }),
    });
  } catch (cause) {
    if (isAbort(cause)) throw cause;

    throw new ApiError(
      `Could not reach the Dariise API at ${apiBaseUrl()}.`,
      0,
      null,
      cause,
    );
  }

  const payload = await parseBody(response);

  if (!response.ok) {
    throw new ApiError(
      errorMessage(payload, response.status),
      response.status,
      errorCode(payload),
      payload,
    );
  }

  return payload as T;
}

export const projects = {
  list: (query: { search?: string } = {}, options?: RequestOptions) =>
    request<Project[]>("GET", "/v1/projects", { ...options, query }),

  get: (projectKey: string, options?: RequestOptions) =>
    request<Project>("GET", `/v1/projects/${projectKey}`, options),

  create: (input: { name: string }, options?: RequestOptions) =>
    request<Project>("POST", "/v1/projects", { ...options, body: input }),

  update: (
    projectKey: string,
    input: UpdateProjectInput,
    options?: RequestOptions,
  ) =>
    request<Project>("PATCH", `/v1/projects/${projectKey}`, {
      ...options,
      body: input,
    }),
};

export const environments = {
  list: (
    projectKey: string,
    query: Partial<EnvironmentListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<EnvironmentSummary>>(
      "GET",
      `/v1/projects/${projectKey}/environments`,
      { ...options, query },
    ),

  get: (projectKey: string, environmentKey: string, options?: RequestOptions) =>
    request<EnvironmentDetail>(
      "GET",
      `/v1/projects/${projectKey}/environments/${environmentKey}`,
      options,
    ),

  create: (
    projectKey: string,
    input: CreateEnvironmentInput,
    options?: RequestOptions,
  ) =>
    request<EnvironmentDetail>(
      "POST",
      `/v1/projects/${projectKey}/environments`,
      { ...options, body: input },
    ),

  update: (
    projectKey: string,
    environmentKey: string,
    input: UpdateEnvironmentInput,
    options?: RequestOptions,
  ) =>
    request<EnvironmentDetail>(
      "PATCH",
      `/v1/projects/${projectKey}/environments/${environmentKey}`,
      { ...options, body: input },
    ),

  archive: (
    projectKey: string,
    environmentKey: string,
    options?: RequestOptions,
  ) =>
    request<EnvironmentDetail>(
      "POST",
      `/v1/projects/${projectKey}/environments/${environmentKey}/archive`,
      options,
    ),

  unarchive: (
    projectKey: string,
    environmentKey: string,
    options?: RequestOptions,
  ) =>
    request<EnvironmentDetail>(
      "POST",
      `/v1/projects/${projectKey}/environments/${environmentKey}/unarchive`,
      options,
    ),

  updateSettings: (
    projectKey: string,
    environmentKey: string,
    input: UpdateEnvironmentSettingsInput,
    options?: RequestOptions,
  ) =>
    request<EnvironmentDetail>(
      "PATCH",
      `/v1/projects/${projectKey}/environments/${environmentKey}/settings`,
      { ...options, body: input },
    ),
};

export const changeRequests = {
  list: (
    projectKey: string,
    flagKey: string,
    query: Partial<FlagChangeRequestListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<FlagChangeRequest>>(
      "GET",
      `/v1/projects/${projectKey}/flags/${flagKey}/change-requests`,
      { ...options, query },
    ),

  create: (
    projectKey: string,
    flagKey: string,
    input: CreateFlagChangeRequestInput,
    options?: RequestOptions,
  ) =>
    request<FlagChangeRequest>(
      "POST",
      `/v1/projects/${projectKey}/flags/${flagKey}/change-requests`,
      { ...options, body: input },
    ),

  approve: (
    projectKey: string,
    flagKey: string,
    requestId: string,
    input: DecideFlagChangeRequestInput = {},
    options?: RequestOptions,
  ) =>
    request<FlagChangeRequest>(
      "POST",
      `/v1/projects/${projectKey}/flags/${flagKey}/change-requests/${requestId}/approve`,
      { ...options, body: input },
    ),

  reject: (
    projectKey: string,
    flagKey: string,
    requestId: string,
    input: DecideFlagChangeRequestInput = {},
    options?: RequestOptions,
  ) =>
    request<FlagChangeRequest>(
      "POST",
      `/v1/projects/${projectKey}/flags/${flagKey}/change-requests/${requestId}/reject`,
      { ...options, body: input },
    ),
};

/**
 * The two addresses a flag has.
 *
 * A flag is project-scoped: its identity — key, name, tags, owner, status,
 * variations — lives at `flagPath`, while everything it does in one environment
 * lives under `flagConfigPath`, which adds the environment segment.
 */
function flagPath(projectKey: string, flagKey: string): string {
  return `/v1/projects/${projectKey}/flags/${flagKey}`;
}

function flagConfigPath(
  projectKey: string,
  flagKey: string,
  environmentKey: string,
): string {
  return `${flagPath(projectKey, flagKey)}/environments/${environmentKey}`;
}

export const flags = {
  list: (
    projectKey: string,
    query: Partial<FlagListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<FlagSummary>>("GET", `/v1/projects/${projectKey}/flags`, {
      ...options,
      query,
    }),

  create: (
    projectKey: string,
    input: CreateFlagInput,
    options?: RequestOptions,
  ) =>
    request<FlagDetail>("POST", `/v1/projects/${projectKey}/flags`, {
      ...options,
      body: input,
    }),

  get: (projectKey: string, flagKey: string, options?: RequestOptions) =>
    request<FlagDetail>("GET", flagPath(projectKey, flagKey), options),

  update: (
    projectKey: string,
    flagKey: string,
    input: UpdateFlagInput,
    options?: RequestOptions,
  ) =>
    request<FlagDetail>("PATCH", flagPath(projectKey, flagKey), {
      ...options,
      body: input,
    }),

  archive: (projectKey: string, flagKey: string, options?: RequestOptions) =>
    request<{ key: string; status: string }>(
      "DELETE",
      flagPath(projectKey, flagKey),
      options,
    ),

  /** The reverse of `archive`. It does not switch the flag on again. */
  unarchive: (projectKey: string, flagKey: string, options?: RequestOptions) =>
    request<{ key: string; status: string }>(
      "POST",
      `${flagPath(projectKey, flagKey)}/unarchive`,
      options,
    ),

  /** The workspace-wide screen; flag keys collide across projects. */
  listWorkspace: (
    query: Partial<WorkspaceFlagListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<WorkspaceFlagSummary>>("GET", "/v1/flags", {
      ...options,
      query,
    }),

  /** Resolve one flag by key alone, narrowing it to one environment's state. */
  resolve: (
    flagKey: string,
    projectKey: string,
    environmentKey?: string,
    options?: RequestOptions,
  ) =>
    request<FlagDetail>("GET", `/v1/flags/${flagKey}`, {
      ...options,
      query: { projectKey, environmentKey },
    }),

  listVariations: (
    projectKey: string,
    flagKey: string,
    options?: RequestOptions,
  ) =>
    request<FlagVariation[]>(
      "GET",
      `${flagPath(projectKey, flagKey)}/variations`,
      options,
    ),

  createVariation: (
    projectKey: string,
    flagKey: string,
    input: CreateFlagVariationInput,
    options?: RequestOptions,
  ) =>
    request<FlagVariation[]>(
      "POST",
      `${flagPath(projectKey, flagKey)}/variations`,
      { ...options, body: input },
    ),

  updateVariation: (
    projectKey: string,
    flagKey: string,
    variationKey: string,
    input: UpdateFlagVariationInput,
    options?: RequestOptions,
  ) =>
    request<FlagVariation[]>(
      "PATCH",
      `${flagPath(projectKey, flagKey)}/variations/${variationKey}`,
      { ...options, body: input },
    ),

  /** Refused with a 409 while an environment still refers to the variation. */
  removeVariation: (
    projectKey: string,
    flagKey: string,
    variationKey: string,
    options?: RequestOptions,
  ) =>
    request<FlagVariation[]>(
      "DELETE",
      `${flagPath(projectKey, flagKey)}/variations/${variationKey}`,
      options,
    ),

  getEnvironmentConfig: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    options?: RequestOptions,
  ) =>
    request<FlagEnvironmentConfig>(
      "GET",
      flagConfigPath(projectKey, flagKey, environmentKey),
      options,
    ),

  updateEnvironmentConfig: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: UpdateFlagConfigInput,
    options?: RequestOptions,
  ) =>
    request<FlagEnvironmentConfig>(
      "PATCH",
      flagConfigPath(projectKey, flagKey, environmentKey),
      { ...options, body: input },
    ),

  /**
   * The list's quick toggle: one field, no read-modify-write.
   *
   * Switching a flag on also rolls it out in full server-side, so the returned
   * configuration — not the argument — is what the row should render.
   */
  setEnabled: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    enabled: boolean,
    options?: RequestOptions,
  ) =>
    request<FlagEnvironmentConfig>(
      "PATCH",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/enabled`,
      { ...options, body: { enabled } },
    ),

  rules: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    options?: RequestOptions,
  ) =>
    request<TargetingRule[]>(
      "GET",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/rules`,
      options,
    ),

  replaceRules: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: ReplaceTargetingRulesInput,
    options?: RequestOptions,
  ) =>
    request<TargetingRule[]>(
      "PUT",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/rules`,
      { ...options, body: input },
    ),

  targets: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    options?: RequestOptions,
  ) =>
    request<FlagIndividualTarget[]>(
      "GET",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/targets`,
      options,
    ),

  replaceTargets: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: ReplaceIndividualTargetsInput,
    options?: RequestOptions,
  ) =>
    request<FlagIndividualTarget[]>(
      "PUT",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/targets`,
      { ...options, body: input },
    ),

  /** Project-wide: the dependency graph is not an environment's property. */
  dependencies: (projectKey: string, flagKey: string, options?: RequestOptions) =>
    request<FlagDependencyGraph>(
      "GET",
      `${flagPath(projectKey, flagKey)}/dependencies`,
      options,
    ),

  versions: (
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    query: Partial<PaginationQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<FlagVersion>>(
      "GET",
      `${flagConfigPath(projectKey, flagKey, environmentKey)}/versions`,
      { ...options, query },
    ),
};

export const segments = {
  list: (
    projectKey: string,
    query: Partial<SegmentListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<SegmentSummary>>(
      "GET",
      `/v1/projects/${projectKey}/segments`,
      { ...options, query },
    ),

  create: (
    projectKey: string,
    input: CreateSegmentInput,
    options?: RequestOptions,
  ) =>
    request<SegmentDetail>("POST", `/v1/projects/${projectKey}/segments`, {
      ...options,
      body: input,
    }),

  get: (projectKey: string, segmentKey: string, options?: RequestOptions) =>
    request<SegmentDetail>(
      "GET",
      `/v1/projects/${projectKey}/segments/${segmentKey}`,
      options,
    ),

  update: (
    projectKey: string,
    segmentKey: string,
    input: UpdateSegmentInput,
    options?: RequestOptions,
  ) =>
    request<SegmentDetail>(
      "PATCH",
      `/v1/projects/${projectKey}/segments/${segmentKey}`,
      { ...options, body: input },
    ),

  archive: (projectKey: string, segmentKey: string, options?: RequestOptions) =>
    request<{ key: string; archivedAt: string }>(
      "DELETE",
      `/v1/projects/${projectKey}/segments/${segmentKey}`,
      options,
    ),

  flags: (projectKey: string, segmentKey: string, options?: RequestOptions) =>
    request<SegmentFlag[]>(
      "GET",
      `/v1/projects/${projectKey}/segments/${segmentKey}/flags`,
      options,
    ),
};

export const apiKeys = {
  list: (
    projectKey: string,
    query: Partial<ApiKeyListQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<ApiKey>>("GET", `/v1/projects/${projectKey}/api-keys`, {
      ...options,
      query,
    }),

  /**
   * Issue a key. This is one of the two responses that carries `secret`; the
   * dashboard shows it once and never asks for it again.
   */
  create: (
    projectKey: string,
    input: CreateApiKeyInput,
    options?: RequestOptions,
  ) =>
    request<CreatedApiKey>("POST", `/v1/projects/${projectKey}/api-keys`, {
      ...options,
      body: input,
    }),

  /** Identity only: the prefix, the secret and its hash are not touched. */
  update: (
    projectKey: string,
    keyId: string,
    input: UpdateApiKeyInput,
    options?: RequestOptions,
  ) =>
    request<ApiKey>(
      "PATCH",
      `/v1/projects/${projectKey}/api-keys/${keyId}`,
      { ...options, body: input },
    ),

  /**
   * Replace a key's secret, keeping its row and prefix. The reply carries the
   * new secret, which is the last time it can be read.
   */
  rotate: (projectKey: string, keyId: string, options?: RequestOptions) =>
    request<CreatedApiKey>(
      "POST",
      `/v1/projects/${projectKey}/api-keys/${keyId}/rotate`,
      options,
    ),

  revoke: (projectKey: string, keyId: string, options?: RequestOptions) =>
    request<ApiKey>(
      "DELETE",
      `/v1/projects/${projectKey}/api-keys/${keyId}`,
      options,
    ),
};

export const audit = {
  listForProject: (
    projectKey: string,
    query: Partial<AuditLogQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<AuditLogEntry>>(
      "GET",
      `/v1/projects/${projectKey}/audit-logs`,
      { ...options, query },
    ),

  /** The global screen renders outside a project, so it spans the workspace. */
  listForWorkspace: (
    query: Partial<AuditLogQuery> = {},
    options?: RequestOptions,
  ) =>
    request<ApiPage<AuditLogEntry>>("GET", "/v1/audit-logs", {
      ...options,
      query,
    }),
};

export const members = {
  list: (projectKey: string, options?: RequestOptions) =>
    request<ProjectMember[]>(
      "GET",
      `/v1/projects/${projectKey}/members`,
      options,
    ),

  add: (
    projectKey: string,
    input: AddProjectMemberInput,
    options?: RequestOptions,
  ) =>
    request<ProjectMember>("POST", `/v1/projects/${projectKey}/members`, {
      ...options,
      body: input,
    }),

  updateRole: (
    projectKey: string,
    userId: string,
    role: ProjectMember["role"],
    options?: RequestOptions,
  ) =>
    request<ProjectMember>(
      "PATCH",
      `/v1/projects/${projectKey}/members/${userId}`,
      { ...options, body: { role } },
    ),

  remove: (projectKey: string, userId: string, options?: RequestOptions) =>
    request<{ userId: string; removed: true }>(
      "DELETE",
      `/v1/projects/${projectKey}/members/${userId}`,
      options,
    ),
};

export const me = {
  updateProfile: (input: UpdateProfileInput, options?: RequestOptions) =>
    request<SessionUser>("PATCH", "/v1/me", { ...options, body: input }),

  changePassword: (input: ChangePasswordInput, options?: RequestOptions) =>
    request<{ status: string }>("POST", "/v1/me/password", {
      ...options,
      body: input,
    }),

  updatePreferences: (
    input: UpdatePreferencesInput,
    options?: RequestOptions,
  ) =>
    request<UserPreferences>("PATCH", "/v1/me/preferences", {
      ...options,
      body: input,
    }),

  updateNotifications: (
    input: UpdateNotificationsInput,
    options?: RequestOptions,
  ) =>
    request<UserPreferences>("PATCH", "/v1/me/notifications", {
      ...options,
      body: input,
    }),
};

export const workspace = {
  get: (options?: RequestOptions) =>
    request<WorkspaceProfile>("GET", "/v1/workspace", options),

  update: (input: UpdateWorkspaceInput, options?: RequestOptions) =>
    request<WorkspaceProfile>("PATCH", "/v1/workspace", {
      ...options,
      body: input,
    }),

  getSecurity: (options?: RequestOptions) =>
    request<WorkspaceSecuritySettings>("GET", "/v1/workspace/security", options),

  updateSecurity: (
    input: UpdateWorkspaceSecurityInput,
    options?: RequestOptions,
  ) =>
    request<WorkspaceSecuritySettings>("PATCH", "/v1/workspace/security", {
      ...options,
      body: input,
    }),
};

/**
 * Evaluate a flag for a user.
 *
 * This is the same contract the Dariise SDK uses; the dashboard calls it to
 * debug why a user received a particular variation.
 */
export function evaluate(
  input: EvaluateRequest,
  options?: RequestOptions,
): Promise<EvaluationResult> {
  return request<EvaluationResult>("POST", "/v1/evaluate", {
    ...options,
    body: input,
  });
}
