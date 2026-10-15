import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";

import { env } from "./config/index.js";
import { pool } from "./db/client.js";
import { BrevoTransport } from "./integrations/brevo/index.js";
import { createSessionMiddleware } from "./middleware/authorization.js";
import { createApiKeyMiddleware } from "./middleware/api-key.js";
import { ApiKeysController } from "./modules/api-keys/api-keys.controller.js";
import { ApiKeysRepository } from "./modules/api-keys/api-keys.repository.js";
import { createApiKeysRoutes } from "./modules/api-keys/api-keys.routes.js";
import { ApiKeysService } from "./modules/api-keys/api-keys.service.js";
import { AccountController } from "./modules/account/account.controller.js";
import { AccountRepository } from "./modules/account/account.repository.js";
import { createAccountRoutes } from "./modules/account/account.routes.js";
import { AccountService } from "./modules/account/account.service.js";
import {
  ChangeRequestsController,
  ChangeRequestsRepository,
  ChangeRequestsService,
  createChangeRequestsRoutes,
} from "./modules/change-requests/index.js";
import { AuditLogController } from "./modules/audit-log/audit-log.controller.js";
import { AuditLogRepository } from "./modules/audit-log/audit-log.repository.js";
import { createAuditLogRoutes } from "./modules/audit-log/audit-log.routes.js";
import { AuditLogService } from "./modules/audit-log/audit-log.service.js";
import {
  AuthController,
  AuthRepository,
  AuthService,
  createAuthConfig,
  createAuthRoutes,
} from "./modules/auth/index.js";
import { EmailRenderer, EmailService } from "./modules/email/index.js";
import { EnvironmentsController } from "./modules/environments/environments.controller.js";
import { EnvironmentsRepository } from "./modules/environments/environments.repository.js";
import { createEnvironmentsRoutes } from "./modules/environments/environments.routes.js";
import { EnvironmentsService } from "./modules/environments/environments.service.js";
import { EvaluationController } from "./modules/evaluation/evaluation.controller.js";
import { EvaluationRepository } from "./modules/evaluation/evaluation.repository.js";
import { createEvaluationRoutes } from "./modules/evaluation/evaluation.routes.js";
import { EvaluationService } from "./modules/evaluation/evaluation.service.js";
import { FlagsController } from "./modules/flags/flags.controller.js";
import { FlagsRepository } from "./modules/flags/flags.repository.js";
import { createFlagsRoutes } from "./modules/flags/flags.routes.js";
import { FlagsService } from "./modules/flags/flags.service.js";
import { ProjectAccessRepository } from "./modules/project-access/project-access.repository.js";
import { ProjectAccessService } from "./modules/project-access/project-access.service.js";
import { ProjectsController } from "./modules/projects/projects.controller.js";
import { ProjectsRepository } from "./modules/projects/projects.repository.js";
import { createProjectsRoutes } from "./modules/projects/projects.routes.js";
import { ProjectsService } from "./modules/projects/projects.service.js";
import { ProjectMembersController } from "./modules/project-members/project-members.controller.js";
import { ProjectMembersRepository } from "./modules/project-members/project-members.repository.js";
import { createProjectMembersRoutes } from "./modules/project-members/project-members.routes.js";
import { ProjectMembersService } from "./modules/project-members/project-members.service.js";
import { SegmentsController } from "./modules/segments/segments.controller.js";
import { SegmentsRepository } from "./modules/segments/segments.repository.js";
import { createSegmentsRoutes } from "./modules/segments/segments.routes.js";
import { SegmentsService } from "./modules/segments/segments.service.js";
import {
  createSdkRoutes,
  SdkController,
  SdkRepository,
  SdkService,
} from "./modules/sdk/index.js";
import { WorkspaceController } from "./modules/workspace/workspace.controller.js";
import { WorkspaceRepository } from "./modules/workspace/workspace.repository.js";
import { createWorkspaceRoutes } from "./modules/workspace/workspace.routes.js";
import { WorkspaceService } from "./modules/workspace/workspace.service.js";
import { errorResponse } from "./shared/http/errors.js";
import { sentry } from "@sentry/hono/node";

const emailService = new EmailService(
  new BrevoTransport(),
  new EmailRenderer(),
);

console.info(
  `[email] Brevo transport configured, sending from ${env.emailFrom}`,
);

/**
 * The Better Auth instance behind `/api/auth/*`.
 *
 * Exported alongside `app` because the plugin endpoints this deployment relies
 * on include server-only ones — `getVerificationOTP` most of all, which is how
 * a test reads the code an email would have carried without reaching into the
 * verification table or weakening the storage to make it readable.
 */
export const auth = createAuthConfig(emailService);
const authRepository = new AuthRepository();
const projectAccessRepository = new ProjectAccessRepository();
const projectsRepository = new ProjectsRepository();
const flagsRepository = new FlagsRepository();
const environmentsRepository = new EnvironmentsRepository();
const segmentsRepository = new SegmentsRepository();
const apiKeysRepository = new ApiKeysRepository();
const auditLogRepository = new AuditLogRepository();
const changeRequestsRepository = new ChangeRequestsRepository();
const accountRepository = new AccountRepository();
const projectMembersRepository = new ProjectMembersRepository();
const evaluationRepository = new EvaluationRepository();
const sdkRepository = new SdkRepository();
const workspaceRepository = new WorkspaceRepository();

const projectAccessService = new ProjectAccessService(projectAccessRepository);
const segmentsService = new SegmentsService(
  segmentsRepository,
  projectAccessService,
);
// Injected so the flags module never imports the segments module.
const flagsService = new FlagsService(
  flagsRepository,
  projectAccessService,
  (projectId, keys) => segmentsService.findUnknownKeys(projectId, keys),
);
const environmentsService = new EnvironmentsService(
  environmentsRepository,
  projectAccessService,
  // Injected so the environments module never imports the flags module: the
  // flags module is what knows what a flag is made of.
  (tx, input) => flagsService.initializeEnvironmentConfigs(tx, input),
);
const apiKeysService = new ApiKeysService(
  apiKeysRepository,
  projectAccessService,
);
// The SDK surface authenticates runtime keys only; the resolver is the api-keys
// module's, so this middleware owns no query of its own.
const apiKeyMiddleware = createApiKeyMiddleware((secret) =>
  apiKeysService.resolveApiKey(secret),
);
const sdkService = new SdkService(sdkRepository);
const sdkController = new SdkController(sdkService);
const auditLogService = new AuditLogService(
  auditLogRepository,
  projectAccessService,
);
// Injected so the projects module never reaches into environments itself.
const projectsService = new ProjectsService(
  projectsRepository,
  (tx, projectId) =>
    environmentsService.createStarterEnvironments(tx, projectId),
  projectAccessService,
);
const workspaceService = new WorkspaceService(workspaceRepository);

// The change-requests module authorises the change; the flags module performs
// it. `app.ts` joins them so neither module imports the other.
const changeRequestsService = new ChangeRequestsService(
  changeRequestsRepository,
  projectAccessService,
  {
    validate: (actor, change) =>
      flagsService.validateProposedChange(
        actor,
        change.projectKey,
        change.flagKey,
        change.environmentKey,
        change.payload,
      ),
    apply: (tx, actor, change) =>
      flagsService.publishApprovedChange(
        tx,
        actor,
        change.projectKey,
        change.flagKey,
        change.environmentKey,
        change.payload,
      ),
  },
);
const authService = new AuthService(
  authRepository,
  (organizationId) => projectsService.hasProject(organizationId),
  auth.api.getSession,
  {
    updateUser: auth.api.updateUser,
    changePassword: auth.api.changePassword,
  },
);
const accountService = new AccountService(accountRepository, authService);
const projectMembersService = new ProjectMembersService(
  projectMembersRepository,
  projectAccessService,
);
const evaluationService = new EvaluationService(evaluationRepository);

const authController = new AuthController(authService);
const projectsController = new ProjectsController(projectsService);
const flagsController = new FlagsController(flagsService);
const environmentsController = new EnvironmentsController(environmentsService);
const segmentsController = new SegmentsController(segmentsService);
const apiKeysController = new ApiKeysController(apiKeysService);
const auditLogController = new AuditLogController(auditLogService);
const changeRequestsController = new ChangeRequestsController(
  changeRequestsService,
);
const accountController = new AccountController(accountService);
const projectMembersController = new ProjectMembersController(
  projectMembersService,
);
const evaluationController = new EvaluationController(evaluationService);
const workspaceController = new WorkspaceController(workspaceService);

// One instance shared by both routers, so a request resolves its session once.
const sessionMiddleware = createSessionMiddleware((headers) =>
  authService.resolveRequestContext(headers),
);

const authRoutes = createAuthRoutes({
  controller: authController,
  sessionMiddleware,
  authHandler: auth.handler,
});
const projectRoutes = createProjectsRoutes({
  controller: projectsController,
  sessionMiddleware,
});
// Mounted at `/`: the module owns both the project-scoped paths and `/v1/flags`.
const flagRoutes = createFlagsRoutes({
  controller: flagsController,
  sessionMiddleware,
});
// A second router under `/v1/projects`, for the environment sub-resources.
const environmentRoutes = createEnvironmentsRoutes({
  controller: environmentsController,
  sessionMiddleware,
});
const segmentRoutes = createSegmentsRoutes({
  controller: segmentsController,
  sessionMiddleware,
});
// A fourth router under `/v1/projects`, for the approval flow.
const changeRequestRoutes = createChangeRequestsRoutes({
  controller: changeRequestsController,
  sessionMiddleware,
});
const apiKeyRoutes = createApiKeysRoutes({
  controller: apiKeysController,
  sessionMiddleware,
});
// Mounted at `/`: it serves both `/v1/audit-logs` and the project-scoped list.
const auditLogRoutes = createAuditLogRoutes({
  controller: auditLogController,
  sessionMiddleware,
});
// Mounted at `/`: `GET /v1/me` stays with the auth module, the writes live here.
const accountRoutes = createAccountRoutes({
  controller: accountController,
  sessionMiddleware,
});
const projectMemberRoutes = createProjectMembersRoutes({
  controller: projectMembersController,
  sessionMiddleware,
});
// Mounted at `/`: `/v1/evaluate` sits outside any project path.
const evaluationRoutes = createEvaluationRoutes({
  controller: evaluationController,
  sessionMiddleware,
});
// Mounted at `/`: the SDK surface, which accepts a runtime key and no session.
const sdkRoutes = createSdkRoutes({
  controller: sdkController,
  apiKeyMiddleware,
});
const workspaceRoutes = createWorkspaceRoutes({
  controller: workspaceController,
  sessionMiddleware,
});

export const app = new Hono();

app.use("*", secureHeaders());
app.use("*", logger());
app.use(sentry(app));

app.use("*", (c, next) =>
  cors({
    origin: ["http://localhost:3000", "https://flags.iwifunni.cc"],
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    maxAge: 600,
  })(c, next),
);

app.get("/healthz", (c) => c.json({ status: "ok" }));

app.get("/readyz", async (c) => {
  const checks: Record<string, "ok" | "error" | "not_configured"> = {};

  try {
    await pool.query("select 1");
    checks.database = "ok";
  } catch {
    checks.database = "error";
  }

  checks.redis = "not_configured";

  const ready = checks.database === "ok";

  return c.json(
    { status: ready ? "ready" : "unready", checks },
    ready ? 200 : 503,
  );
});

import * as Sentry from "@sentry/hono/node";

app.get("/debug-sentry", () => {
  // Send a log before throwing the error
  Sentry.logger.info("User triggered test error", {
    action: "test_error_endpoint",
  });
  // Send a test metric before throwing the error
  Sentry.metrics.count("test_counter", 1);
  throw new Error("My first Sentry error!");
});

app.route("/", authRoutes);
app.route("/v1/projects", projectRoutes);
app.route("/v1/projects", environmentRoutes);
app.route("/v1/projects", segmentRoutes);
app.route("/v1/projects", apiKeyRoutes);
app.route("/v1/projects", changeRequestRoutes);
app.route("/", auditLogRoutes);
app.route("/", accountRoutes);
app.route("/v1/projects", projectMemberRoutes);
app.route("/", evaluationRoutes);
app.route("/", sdkRoutes);
app.route("/", workspaceRoutes);
app.route("/", flagRoutes);

app.notFound((c) =>
  c.json(
    { error: { code: "not_found", message: `No route for ${c.req.path}.` } },
    404,
  ),
);

app.onError((error, c) => errorResponse(c, error));
