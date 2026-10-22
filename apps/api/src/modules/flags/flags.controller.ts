import {
  createFlagSchema,
  createFlagVariationSchema,
  flagListQuerySchema,
  flagVersionNumberSchema,
  clientFlagVisibilitySchema,
  scheduleFlagChangeSchema,
  scheduledFlagChangeIdSchema,
  armFlagRollbackSchema,
  paginationQuerySchema,
  publishTargetingSchema,
  replaceIndividualTargetsSchema,
  replaceTargetingRulesSchema,
  setFlagEnabledSchema,
  updateFlagConfigSchema,
  updateFlagSchema,
  updateFlagVariationSchema,
  workspaceFlagListQuerySchema,
} from "@iwifunni/contracts";
import type { Context } from "hono";

import { requireWorkspace } from "../../middleware/authorization.js";
import { ApiError } from "../../shared/http/errors.js";
import type { SessionEnv } from "../auth/auth.types.js";
import type { FlagsService } from "./flags.service.js";
import type { FlagsActorContext } from "./flags.types.js";

export class FlagsController {
  constructor(private readonly service: FlagsService) {}

  async armRollback(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = armFlagRollbackSchema.safeParse(await this.body(c));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.armRollback(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
      201,
    );
  }
  async listRollbacks(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = paginationQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.listRollbacks(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data.limit,
        parsed.data.cursor,
      ),
    );
  }
  async cancelRollback(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = scheduledFlagChangeIdSchema.safeParse(
      c.req.param("policyId"),
    );
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    await this.service.cancelRollback(
      actor,
      this.param(c, "projectKey"),
      this.param(c, "flagKey"),
      this.param(c, "environmentKey"),
      parsed.data,
    );
    return c.body(null, 204);
  }

  async clientVisibility(c: Context<SessionEnv>): Promise<Response> {
    return c.json(
      await this.service.clientVisibility(
        await this.actor(c),
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async setClientVisibility(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = clientFlagVisibilitySchema.safeParse(await this.body(c));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.setClientVisibility(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        parsed.data.clientVisible,
      ),
    );
  }

  async scheduleChange(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = scheduleFlagChangeSchema.safeParse(await this.body(c));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.scheduleChange(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
      201,
    );
  }

  async listSchedules(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = paginationQuerySchema.safeParse(c.req.query());
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.listSchedules(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data.limit,
        parsed.data.cursor,
      ),
    );
  }

  async cancelSchedule(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = scheduledFlagChangeIdSchema.safeParse(
      c.req.param("scheduleId"),
    );
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    await this.service.cancelSchedule(
      actor,
      this.param(c, "projectKey"),
      this.param(c, "flagKey"),
      this.param(c, "environmentKey"),
      parsed.data,
    );
    return c.body(null, 204);
  }

  async getVersion(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = flagVersionNumberSchema.safeParse(c.req.param("version"));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    return c.json(
      await this.service.getVersion(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  async restoreVersion(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = flagVersionNumberSchema.safeParse(c.req.param("version"));
    if (!parsed.success)
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    await this.service.restoreVersion(
      actor,
      this.param(c, "projectKey"),
      this.param(c, "flagKey"),
      this.param(c, "environmentKey"),
      parsed.data,
    );
    return c.body(null, 204);
  }

  async listWorkspace(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = workspaceFlagListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(await this.service.listWorkspace(actor, parsed.data));
  }

  async list(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = flagListQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.list(actor, this.param(c, "projectKey"), parsed.data),
    );
  }

  async create(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createFlagSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    const created = await this.service.create(
      actor,
      this.param(c, "projectKey"),
      parsed.data,
    );

    return c.json(created, 201);
  }

  /** A flag is project-scoped, so its key alone identifies it inside a project. */
  async get(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.get(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async update(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateFlagSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.update(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        parsed.data,
      ),
    );
  }

  async archive(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.archive(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async unarchive(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.unarchive(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async getVariations(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.getVariations(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async addVariation(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = createFlagVariationSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.addVariation(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        parsed.data,
      ),
      201,
    );
  }

  async updateVariation(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateFlagVariationSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateVariation(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "variationKey"),
        parsed.data,
      ),
    );
  }

  async removeVariation(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.removeVariation(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "variationKey"),
      ),
    );
  }

  async getEnvironmentConfig(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.getEnvironmentConfig(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
      ),
    );
  }

  async updateEnvironmentConfig(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = updateFlagConfigSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.updateEnvironmentConfig(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  /**
   * The list's quick toggle: one flag, one environment, one field.
   *
   * Separate from `updateEnvironmentConfig`, which takes the whole published
   * configuration; this takes only the switch, so a list row can move it without
   * first reading and re-sending everything else.
   */
  async setEnvironmentEnabled(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = setFlagEnabledSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.setEnvironmentEnabled(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  /** Flag keys are unique per project, so only the project key is required here. */
  async resolve(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const projectKey = c.req.query("projectKey");
    const environmentKey = c.req.query("environmentKey");

    if (!projectKey) {
      throw ApiError.badRequest("A projectKey query parameter is required.");
    }

    return c.json(
      await this.service.resolve(
        actor,
        this.param(c, "flagKey"),
        projectKey,
        environmentKey,
      ),
    );
  }

  async getRules(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.getRules(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
      ),
    );
  }

  async replaceRules(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = replaceTargetingRulesSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.replaceRules(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  async getTargets(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.getTargets(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
      ),
    );
  }

  async replaceTargets(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = replaceIndividualTargetsSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.replaceTargets(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  async publishTargeting(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = publishTargetingSchema.safeParse(await this.body(c));

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.publishTargeting(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data,
      ),
    );
  }

  async getDependencies(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);

    return c.json(
      await this.service.getDependencies(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
      ),
    );
  }

  async listVersions(c: Context<SessionEnv>): Promise<Response> {
    const actor = await this.actor(c);
    const parsed = paginationQuerySchema.safeParse(c.req.query());

    if (!parsed.success) {
      throw ApiError.badRequest(this.firstIssue(parsed.error.issues));
    }

    return c.json(
      await this.service.listVersions(
        actor,
        this.param(c, "projectKey"),
        this.param(c, "flagKey"),
        this.param(c, "environmentKey"),
        parsed.data.limit,
        parsed.data.cursor,
      ),
    );
  }

  private async actor(c: Context<SessionEnv>): Promise<FlagsActorContext> {
    const context = await requireWorkspace(c);

    return {
      organizationId: context.workspace.id,
      workspaceRole: context.workspace.role,
      userId: context.user.id,
      userName: context.user.name,
    };
  }

  /** The router always defines these; the type does not know that. */
  private param(c: Context<SessionEnv>, name: string): string {
    const value = c.req.param(name);

    if (!value) {
      throw ApiError.badRequest(`Missing ${name} in the request path.`);
    }

    return value;
  }

  /** `c.req.json()` throws on malformed input, which must not become a 500. */
  private async body(c: Context<SessionEnv>): Promise<unknown> {
    try {
      return await c.req.json();
    } catch {
      throw ApiError.badRequest("Send a valid JSON body.");
    }
  }

  private firstIssue(issues: ReadonlyArray<{ message: string }>): string {
    return issues[0]?.message ?? "The flag details are not valid.";
  }
}
