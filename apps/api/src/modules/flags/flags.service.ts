import { randomUUID } from "node:crypto";

import {
  defaultVariations,
  variationValueMatchesType,
  type AuditAction,
  type CreateFlagInput,
  type CreateFlagVariationInput,
  type FlagChangePayload,
  type FlagDependencyGraph,
  type FlagDetail,
  type FlagEnvironmentConfig,
  type FlagIndividualTarget,
  type FlagListQuery,
  type FlagSummary,
  type FlagType,
  type FlagVariation,
  type FlagVersion,
  type ReplaceIndividualTargetsInput,
  type ReplaceTargetingRulesInput,
  type SetFlagEnabledInput,
  type TargetingRule,
  type TargetingRuleInput,
  type UpdateFlagConfigInput,
  type UpdateFlagInput,
  type UpdateFlagVariationInput,
  type WorkspaceFlagListQuery,
  type WorkspaceFlagSummary,
} from "@dariise/contracts";

import { writeAuditLog } from "../../db/audit.js";
import { db } from "../../db/client.js";
import { ApiError } from "../../shared/http/errors.js";
import { decodeCursor, toPage } from "../../shared/pagination.js";
import type { Transaction } from "../../shared/types/db.js";
import type { Page } from "../../shared/types/pagination.js";
import type { ProjectAccessService } from "../project-access/index.js";
import { buildDependencyGraph } from "./flags.dependencies.js";
import {
  toFlagDetail,
  toFlagEnvironmentConfig,
  toFlagSummary,
  toFlagVersion,
  toIndividualTargets,
  toTargetingRules,
  toVariations,
  toWorkspaceFlagSummary,
} from "./flags.mapper.js";
import type { FlagsRepository } from "./flags.repository.js";
import {
  WORKSPACE_FLAG_CURSOR_SEPARATOR,
  type EnvironmentRef,
  type EnvironmentScope,
  type FlagEnvironmentSummaryRow,
  type FlagRow,
  type FlagsActorContext,
  type VariationReference,
} from "./flags.types.js";

function toEnvironmentSummary(row: {
  environmentKey: string;
  environmentName: string;
  enabled: boolean;
  rolloutPercentage: number;
}): FlagEnvironmentSummaryRow {
  return {
    environmentKey: row.environmentKey,
    environmentName: row.environmentName,
    enabled: row.enabled,
    rolloutPercentage: row.rolloutPercentage,
  };
}

/** The label a starting variation is created with: its key, capitalised. */
function variationLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function describeReferences(references: VariationReference[]): string {
  const labels = references.map((reference) => {
    const what =
      reference.kind === "rule"
        ? `the "${reference.detail}" rule`
        : reference.kind === "target"
          ? `the target "${reference.detail}"`
          : reference.kind === "off_variation"
            ? "the off variation"
            : "the default variation";

    return `${what} in ${reference.environmentKey}`;
  });

  return [...new Set(labels)].join(", ");
}

/**
 * Reads are viewer-level; every write needs the project role docs/architecture.md
 * §3 grants, and each mutation writes its audit row inside its own transaction.
 *
 * A flag is project-scoped: its identity and its variations are shared, and what
 * it does in one environment lives in that environment's configuration.
 */
export class FlagsService {
  constructor(
    private readonly repository: FlagsRepository,
    private readonly projectAccess: ProjectAccessService,
    /** Injected by `app.ts` so flags never imports the segments module. */
    private readonly findUnknownSegments: (
      projectId: string,
      keys: string[],
    ) => Promise<string[]>,
  ) {}

  /**
   * The workspace-wide screen. Scoped by the session's workspace rather than a
   * project gate, because it deliberately spans every project in it.
   */
  async listWorkspace(
    context: FlagsActorContext,
    query: WorkspaceFlagListQuery,
  ): Promise<Page<WorkspaceFlagSummary>> {
    const rows = await this.repository.listForWorkspace(
      context.organizationId,
      {
        search: query.search,
        status: query.status,
        projectKey: query.projectKey,
        limit: query.limit,
        cursor: decodeCursor(query.cursor),
      },
    );

    const page = toPage(
      rows,
      query.limit,
      (row) =>
        `${row.projectKey}${WORKSPACE_FLAG_CURSOR_SEPARATOR}${row.key}`,
    );

    const data = await this.loadListRows(page.data, {
      environmentKey: query.environmentKey,
    });

    return {
      data: data.map((row) => toWorkspaceFlagSummary(row)),
      nextCursor: page.nextCursor,
    };
  }

  async list(
    context: FlagsActorContext,
    projectKey: string,
    query: FlagListQuery,
  ): Promise<Page<FlagSummary>> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    const environment = query.environmentKey
      ? await this.requireEnvironment(project.id, query.environmentKey)
      : null;

    const rows = await this.repository.list(project.id, {
      search: query.search,
      status: query.status,
      limit: query.limit,
      // The cursor is opaque base64url; the repository compares real keys.
      cursor: decodeCursor(query.cursor),
    });

    const page = toPage(rows, query.limit, (row) => row.key);
    const data = await this.loadListRows(page.data, {
      environmentId: environment?.id,
    });

    return {
      data: data.map((row) => toFlagSummary(row)),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Creating a flag configures it everywhere at once: every environment of the
   * project gets its own configuration and its own first history entry.
   */
  async create(
    context: FlagsActorContext,
    projectKey: string,
    input: CreateFlagInput,
  ): Promise<FlagDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });

    if (await this.repository.findByKey(project.id, input.key)) {
      throw ApiError.conflict(
        "A flag with that key already exists in this project.",
      );
    }

    const environments = await this.repository.listEnvironments(project.id);
    const flagId = randomUUID();
    // A caller may hand over the whole variation list, or leave the conventional
    // pair to the API. The two selections name keys in that list, so the
    // fallback pair is what they point at when nothing was declared.
    const fallback = defaultVariations(input.type);
    const conventional = { defaultVariation: "on", offVariation: "off" };
    const selections = {
      defaultVariation: input.defaultVariation ?? conventional.defaultVariation,
      offVariation: input.offVariation ?? conventional.offVariation,
    };
    const variations = input.variations
      ? input.variations.map((variation) => ({
          key: variation.key,
          name: variation.name ?? variationLabel(variation.key),
          value: variation.value,
        }))
      : [
          {
            key: conventional.defaultVariation,
            name: variationLabel(conventional.defaultVariation),
            value: fallback.on,
          },
          {
            key: conventional.offVariation,
            name: variationLabel(conventional.offVariation),
            value: fallback.off,
          },
        ];

    await db.transaction(async (tx) => {
      await this.repository.insert(tx, {
        id: flagId,
        projectId: project.id,
        key: input.key,
        name: input.name,
        description: input.description ?? null,
        type: input.type,
        tags: input.tags,
        owner: input.owner ?? null,
      });

      await this.repository.insertVariations(tx, { flagId, variations });

      for (const environment of environments) {
        await this.repository.insertConfig(tx, {
          flagId,
          environmentId: environment.id,
          // The environment's selections have to name variations that exist,
          // which the created list guarantees they do.
          offVariationKey: selections.offVariation,
          defaultVariationKey: selections.defaultVariation,
        });

        await this.repository.insertVersion(tx, {
          flagId,
          projectId: project.id,
          environmentId: environment.id,
          version: 1,
          description: "Flag created",
          author: context.userId,
          snapshot: {
            environment: environment.key,
            key: input.key,
            type: input.type,
            tags: input.tags,
          },
        });
      }

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.created",
        target: flagId,
        changes: {
          key: input.key,
          name: input.name,
          type: input.type,
          environments: environments.map((environment) => environment.key),
        },
      });
    });

    return this.loadDetail(await this.requireFlag(project.id, input.key));
  }

  async get(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
  ): Promise<FlagDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });

    return this.loadDetail(await this.requireFlag(project.id, flagKey));
  }

  /** What the flag does in one environment. */
  async getEnvironmentConfig(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
  ): Promise<FlagEnvironmentConfig> {
    return this.loadEnvironmentConfig(
      await this.environmentScope(
        context,
        projectKey,
        flagKey,
        environmentKey,
        "viewer",
      ),
    );
  }

  async getVariations(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
  ): Promise<FlagVariation[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });
    const row = await this.requireFlag(project.id, flagKey);

    return toVariations(await this.repository.listVariations(row.id));
  }

  async addVariation(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    input: CreateFlagVariationInput,
  ): Promise<FlagVariation[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });
    const row = await this.requireFlag(project.id, flagKey);
    const variations = await this.repository.listVariations(row.id);

    if (variations.some((variation) => variation.key === input.key)) {
      throw ApiError.conflict(
        `"${input.key}" is already one of this flag's variations.`,
      );
    }

    if (!variationValueMatchesType(row.type as FlagType, input.value)) {
      throw ApiError.badRequest(
        `The value of "${input.key}" is not a ${row.type}. A flag serves values of the type it was created with.`,
      );
    }

    await db.transaction(async (tx) => {
      await this.repository.insertVariation(tx, {
        flagId: row.id,
        variation: input,
      });

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.variation.added",
        target: row.id,
        changes: { key: input.key },
      });
    });

    return toVariations(await this.repository.listVariations(row.id));
  }

  /** A variation's value or label. Its key identifies it and is not editable. */
  async updateVariation(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    variationKey: string,
    input: UpdateFlagVariationInput,
  ): Promise<FlagVariation[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });
    const row = await this.requireFlag(project.id, flagKey);
    const variations = await this.repository.listVariations(row.id);

    if (!variations.some((variation) => variation.key === variationKey)) {
      throw ApiError.notFound("Variation not found.");
    }

    if (
      input.value !== undefined &&
      !variationValueMatchesType(row.type as FlagType, input.value)
    ) {
      throw ApiError.badRequest(
        `The value of "${variationKey}" is not a ${row.type}.`,
      );
    }

    await db.transaction(async (tx) => {
      await this.repository.updateVariation(tx, row.id, variationKey, input);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.variation.updated",
        target: row.id,
        changes: { key: variationKey, ...input },
      });
    });

    return toVariations(await this.repository.listVariations(row.id));
  }

  /**
   * A variation key can only go once nothing names it, because environments,
   * rules and targets all reference it by key.
   */
  async removeVariation(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    variationKey: string,
  ): Promise<FlagVariation[]> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });
    const row = await this.requireFlag(project.id, flagKey);
    const variations = await this.repository.listVariations(row.id);

    if (!variations.some((variation) => variation.key === variationKey)) {
      throw ApiError.notFound("Variation not found.");
    }

    if (variations.length === 1) {
      throw ApiError.conflict("A flag has to keep at least one variation.");
    }

    const references = await this.repository.findVariationReferences(
      row.id,
      variationKey,
    );

    if (references.length > 0) {
      throw ApiError.conflict(
        `"${variationKey}" is still referenced by ${describeReferences(references)}. Re-point them before removing it.`,
      );
    }

    await db.transaction(async (tx) => {
      await this.repository.deleteVariation(tx, row.id, variationKey);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.variation.removed",
        target: row.id,
        changes: { key: variationKey },
      });
    });

    return toVariations(await this.repository.listVariations(row.id));
  }

  async update(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    input: UpdateFlagInput,
  ): Promise<FlagDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "engineer",
    });
    const row = await this.requireFlag(project.id, flagKey);

    await db.transaction(async (tx) => {
      await this.repository.update(tx, row.id, input);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.updated",
        target: row.id,
        changes: input,
      });
    });

    return this.loadDetail(await this.requireFlag(project.id, flagKey));
  }

  /**
   * Archiving is project-wide: `status` belongs to the flag, not to one
   * environment's configuration.
   */
  async archive(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
  ): Promise<{ key: string; status: string }> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      // docs/architecture.md §3 lets an engineer archive a flag.
      minimumRole: "engineer",
    });
    const row = await this.requireFlag(project.id, flagKey);

    await db.transaction(async (tx) => {
      await this.repository.archive(tx, row.id);

      await writeAuditLog(tx, {
        organizationId: context.organizationId,
        projectId: project.id,
        actor: context.userId,
        actorName: context.userName,
        action: "flag.archived",
        target: row.id,
        changes: { status: "archived" },
      });
    });

    return { key: row.key, status: "archived" };
  }

  async updateEnvironmentConfig(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: UpdateFlagConfigInput,
  ): Promise<FlagEnvironmentConfig> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "engineer",
    );

    this.assertPublishable(scope.environment);
    await this.validateConfigInput(scope, input);

    const action =
      scope.config.enabled !== input.enabled
        ? input.enabled
          ? "flag.enabled"
          : "flag.disabled"
        : scope.config.rolloutPercentage !== input.rolloutPercentage
          ? "rollout.updated"
          : "flag.updated";

    await db.transaction(async (tx) => {
      await this.publishConfig(tx, context, scope, input, action);
    });

    return this.loadEnvironmentConfig({
      ...scope,
      config: await this.requireConfig(scope.flag.id, scope.environment.id),
    });
  }

  /**
   * Flip one flag on or off in one environment, behind the list's quick toggle.
   *
   * Narrower than `updateEnvironmentConfig` on purpose: a list row carries no
   * opinion about variations or rollout, and sending the whole configuration
   * would make the toggle a read-modify-write over fields the reader never saw.
   * Every field the caller did not set is carried over from the stored config, so
   * this can only move `enabled` and the rollout below.
   *
   * Switching on also rolls the flag out to 100%: the two are separate columns,
   * and because 0% now means "serve nobody", switching on without saying so would
   * leave the flag enabled and yet served to no one. Switching off leaves the
   * percentage alone, so it is still there if the flag is switched back on.
   */
  async setEnvironmentEnabled(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: SetFlagEnabledInput,
  ): Promise<FlagEnvironmentConfig> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "engineer",
    );

    this.assertPublishable(scope.environment);

    const config: UpdateFlagConfigInput = {
      enabled: input.enabled,
      offVariation: scope.config.offVariationKey,
      defaultVariation: scope.config.defaultVariationKey,
      rolloutPercentage: input.enabled
        ? 100
        : scope.config.rolloutPercentage,
      bucketBy: scope.config.bucketBy,
    };

    const action = input.enabled ? "flag.enabled" : "flag.disabled";

    await db.transaction(async (tx) => {
      await this.publishConfig(tx, context, scope, config, action);
    });

    return this.loadEnvironmentConfig({
      ...scope,
      config: await this.requireConfig(scope.flag.id, scope.environment.id),
    });
  }

  async getRules(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
  ): Promise<TargetingRule[]> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "viewer",
    );

    return toTargetingRules(
      await this.repository.listRules(scope.flag.id, scope.environment.id),
    );
  }

  async replaceRules(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: ReplaceTargetingRulesInput,
  ): Promise<TargetingRule[]> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "engineer",
    );

    this.assertPublishable(scope.environment);
    await this.validateRules(scope, input);

    await db.transaction(async (tx) => {
      await this.publishRules(tx, context, scope, input.rules);
    });

    return toTargetingRules(
      await this.repository.listRules(scope.flag.id, scope.environment.id),
    );
  }

  async getTargets(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
  ): Promise<FlagIndividualTarget[]> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "viewer",
    );

    return toIndividualTargets(
      await this.repository.listTargets(scope.flag.id, scope.environment.id),
    );
  }

  async replaceTargets(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    input: ReplaceIndividualTargetsInput,
  ): Promise<FlagIndividualTarget[]> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "engineer",
    );

    this.assertPublishable(scope.environment);
    await this.validateTargets(scope, input);

    await db.transaction(async (tx) => {
      await this.publishTargets(tx, context, scope, input.targets);
    });

    return toIndividualTargets(
      await this.repository.listTargets(scope.flag.id, scope.environment.id),
    );
  }

  /** Dependencies are project-scoped: an edge links two flag keys, not two configurations. */
  async getDependencies(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
  ): Promise<FlagDependencyGraph> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });
    const row = await this.requireFlag(project.id, flagKey);

    const rows = await this.repository.listDependencies(project.id, row.key);
    const keys = new Set<string>([row.key]);

    for (const dependency of rows) {
      keys.add(dependency.key);
      keys.add(dependency.requires);
    }

    const statuses = await this.repository.findStatuses(project.id, [...keys]);

    return buildDependencyGraph(row.key, rows, statuses);
  }

  async listVersions(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    limit: number,
    cursor: string | undefined,
  ): Promise<Page<FlagVersion>> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "viewer",
    );

    const rows = await this.repository.listVersions(
      scope.flag.id,
      scope.environment.id,
      limit,
      decodeCursor(cursor),
    );

    const page = toPage(rows, limit, (version) => String(version.version));

    return {
      data: page.data.map((version) =>
        toFlagVersion(version, scope.environment.key),
      ),
      nextCursor: page.nextCursor,
    };
  }

  /** `GET /v1/flags/:flagKey` requires a project key: keys collide across projects. */
  async resolve(
    context: FlagsActorContext,
    flagKey: string,
    projectKey: string,
    environmentKey?: string,
  ): Promise<FlagDetail> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole: "viewer",
    });
    const row = await this.requireFlag(project.id, flagKey);

    if (!environmentKey) {
      return this.loadDetail(row);
    }

    const environment = await this.requireEnvironment(project.id, environmentKey);

    return this.loadDetail(row, { environmentId: environment.id });
  }

  /**
   * Checks a proposed change without writing it, so an invalid proposal is
   * refused when it is made rather than when somebody is asked to approve it.
   */
  async validateProposedChange(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    payload: FlagChangePayload,
  ): Promise<void> {
    await this.resolveApprovedChange(
      context,
      projectKey,
      flagKey,
      environmentKey,
      payload,
    );
  }

  /**
   * Applies an approved change request to a protected environment.
   *
   * The change-requests module owns the approval lifecycle and reaches this
   * through the applier `app.ts` injects; the HTTP layer cannot call it, which
   * is why it is not gated the way the direct writes are. It takes the caller's
   * transaction so the decision and the change commit together: an approver
   * approves a whole change, and half of it must never be visible.
   */
  async publishApprovedChange(
    tx: Transaction,
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    payload: FlagChangePayload,
  ): Promise<void> {
    const scope = await this.resolveApprovedChange(
      context,
      projectKey,
      flagKey,
      environmentKey,
      payload,
    );

    const { config } = payload;
    const action: AuditAction = config
      ? config.enabled !== scope.config.enabled
        ? config.enabled
          ? "flag.enabled"
          : "flag.disabled"
        : scope.config.rolloutPercentage !== config.rolloutPercentage
          ? "rollout.updated"
          : "flag.updated"
      : "flag.updated";

    if (config) {
      await this.publishConfig(tx, context, scope, config, action);
    }

    if (payload.rules) {
      await this.publishRules(tx, context, scope, payload.rules.rules);
    }

    if (payload.targets) {
      await this.publishTargets(tx, context, scope, payload.targets.targets);
    }
  }

  /**
   * Gives every flag of the project a configuration in one environment. Runs in
   * the caller's transaction so an environment is never half-configured, and is
   * idempotent for a flag that already has one.
   */
  async initializeEnvironmentConfigs(
    tx: Transaction,
    input: {
      projectId: string;
      target: EnvironmentRef;
      source: EnvironmentRef | null;
      author: string;
    },
  ): Promise<number> {
    const rows = await this.repository.listForProject(tx, input.projectId);

    for (const row of rows) {
      if (await this.repository.findConfigInTx(tx, row.id, input.target.id)) {
        continue;
      }

      if (input.source) {
        await this.repository.copyConfigIntoEnvironment(tx, {
          sourceFlagId: row.id,
          sourceEnvironmentId: input.source.id,
          targetEnvironmentId: input.target.id,
        });
      } else {
        await this.repository.insertConfig(tx, {
          flagId: row.id,
          environmentId: input.target.id,
        });
      }

      await this.repository.insertVersion(tx, {
        flagId: row.id,
        projectId: input.projectId,
        environmentId: input.target.id,
        version: 1,
        description: input.source
          ? `Copied from ${input.source.name}`
          : "Flag created",
        author: input.author,
        snapshot: {
          environment: input.target.key,
          key: row.key,
          type: row.type,
        },
      });
    }

    return rows.length;
  }

  private async resolveApprovedChange(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    payload: FlagChangePayload,
  ): Promise<EnvironmentScope> {
    const scope = await this.environmentScope(
      context,
      projectKey,
      flagKey,
      environmentKey,
      "engineer",
    );

    if (payload.config) {
      await this.validateConfigInput(scope, payload.config);
    }

    if (payload.rules) {
      await this.validateRules(scope, payload.rules);
    }

    if (payload.targets) {
      await this.validateTargets(scope, payload.targets);
    }

    return scope;
  }

  /**
   * The one environment-scoped method every configuration read and write starts
   * from: the project gate, the environment, the flag, and its configuration.
   */
  private async environmentScope(
    context: FlagsActorContext,
    projectKey: string,
    flagKey: string,
    environmentKey: string,
    minimumRole: "viewer" | "engineer",
  ): Promise<EnvironmentScope> {
    const { project } = await this.projectAccess.require({
      ...context,
      projectKey,
      minimumRole,
    });

    const environment = await this.requireEnvironment(project.id, environmentKey);
    const row = await this.requireFlag(project.id, flagKey);
    const config = await this.requireConfig(row.id, environment.id);

    return { project, flag: row, environment, config };
  }

  /** One flag's identity, its environments and the values it can serve. */
  private async loadDetail(
    row: FlagRow,
    options: { environmentId?: string } = {},
  ): Promise<FlagDetail> {
    const [variations, summaries] = await Promise.all([
      this.repository.listVariations(row.id),
      this.repository.listEnvironmentSummaries([row.id], {
        environmentId: options.environmentId,
      }),
    ]);

    return toFlagDetail(
      { ...row, environments: summaries.map(toEnvironmentSummary) },
      variations,
    );
  }

  private loadEnvironmentConfig(
    scope: EnvironmentScope,
  ): Promise<FlagEnvironmentConfig> {
    return this.repository
      .detailParts(scope.flag.id, scope.environment.id)
      .then((parts) =>
        toFlagEnvironmentConfig(scope.environment, scope.config, parts),
      );
  }

  /** One query attaches every environment's state to a page of flags. */
  private async loadListRows<T extends FlagRow>(
    rows: T[],
    filter: { environmentId?: string; environmentKey?: string },
  ): Promise<Array<T & { environments: FlagEnvironmentSummaryRow[] }>> {
    if (rows.length === 0) return [];

    const summaries = await this.repository.listEnvironmentSummaries(
      rows.map((row) => row.id),
      filter,
    );

    return rows.map((row) => ({
      ...row,
      environments: summaries
        .filter((summary) => summary.flagId === row.id)
        .map(toEnvironmentSummary),
    }));
  }

  private publishConfig(
    tx: Transaction,
    context: FlagsActorContext,
    scope: EnvironmentScope,
    input: UpdateFlagConfigInput,
    action: AuditAction,
  ): Promise<void> {
    return this.writeEnvironmentChange(
      tx,
      context,
      scope,
      action,
      {
        enabled: input.enabled,
        defaultVariation: input.defaultVariation,
        rolloutPercentage: input.rolloutPercentage,
      },
      async () => {
        await this.repository.updateConfig(tx, scope.config.id, input);
      },
      `Configuration published to ${scope.environment.name}`,
      {
        environment: scope.environment.key,
        enabled: input.enabled,
        serve: input.defaultVariation,
      },
    );
  }

  private publishRules(
    tx: Transaction,
    context: FlagsActorContext,
    scope: EnvironmentScope,
    rules: TargetingRuleInput[],
  ): Promise<void> {
    return this.writeEnvironmentChange(
      tx,
      context,
      scope,
      "flag.updated",
      { rules },
      async () => {
        await this.repository.replaceRules(
          tx,
          scope.flag.id,
          scope.environment.id,
          rules,
        );
      },
      `Targeting rules published to ${scope.environment.name}`,
      { environment: scope.environment.key, rules },
    );
  }

  private publishTargets(
    tx: Transaction,
    context: FlagsActorContext,
    scope: EnvironmentScope,
    targets: FlagIndividualTarget[],
  ): Promise<void> {
    return this.writeEnvironmentChange(
      tx,
      context,
      scope,
      "flag.updated",
      { targets },
      async () => {
        await this.repository.replaceTargets(
          tx,
          scope.flag.id,
          scope.environment.id,
          targets,
        );
      },
      `Individual targets published to ${scope.environment.name}`,
      { environment: scope.environment.key, targets },
    );
  }

  /** One environment change: the write, its audit row and its history entry. */
  private async writeEnvironmentChange(
    tx: Transaction,
    context: FlagsActorContext,
    scope: EnvironmentScope,
    action: AuditAction,
    changes: Record<string, unknown>,
    write: () => Promise<void>,
    description: string,
    snapshot: Record<string, unknown>,
  ): Promise<void> {
    await write();

    await writeAuditLog(tx, {
      organizationId: context.organizationId,
      projectId: scope.project.id,
      environmentId: scope.environment.id,
      actor: context.userId,
      actorName: context.userName,
      action,
      target: scope.flag.id,
      changes: { environment: scope.environment.key, ...changes },
    });

    await this.repository.insertVersion(tx, {
      flagId: scope.flag.id,
      projectId: scope.project.id,
      environmentId: scope.environment.id,
      version: await this.repository.nextVersion(
        tx,
        scope.flag.id,
        scope.environment.id,
      ),
      description,
      author: context.userId,
      snapshot,
    });
  }

  /**
   * A protected environment refuses direct publishes. The caller proposes the
   * change instead, and a second person approves it through the change-requests
   * module, which re-enters through `publishApprovedChange`.
   */
  private assertPublishable(environment: EnvironmentRef): void {
    if (environment.isProtected) {
      throw ApiError.approvalRequired(environment.key);
    }
  }

  private async validateConfigInput(
    scope: EnvironmentScope,
    input: UpdateFlagConfigInput,
  ): Promise<void> {
    const variationKeys = new Set(
      (await this.repository.listVariations(scope.flag.id)).map(
        (variation) => variation.key,
      ),
    );

    for (const [field, key] of [
      ["defaultVariation", input.defaultVariation],
      ["offVariation", input.offVariation],
    ] as const) {
      if (!variationKeys.has(key)) {
        throw ApiError.badRequest(
          `"${key}" is not one of the flag's variations (${field}).`,
        );
      }
    }
  }

  private async validateRules(
    scope: EnvironmentScope,
    input: ReplaceTargetingRulesInput,
  ): Promise<void> {
    const known = new Set(
      (await this.repository.listVariations(scope.flag.id)).map(
        (variation) => variation.key,
      ),
    );

    for (const rule of input.rules) {
      if (!known.has(rule.variation)) {
        throw ApiError.badRequest(
          `"${rule.variation}" is not one of the flag's variations.`,
        );
      }
    }

    const segmentKeys = [
      ...new Set(input.rules.flatMap((rule) => rule.segmentKeys)),
    ];

    const unknownSegments = await this.findUnknownSegments(
      scope.project.id,
      segmentKeys,
    );

    if (unknownSegments.length > 0) {
      throw ApiError.badRequest(
        `Unknown segment${unknownSegments.length > 1 ? "s" : ""}: ${unknownSegments.join(", ")}.`,
      );
    }
  }

  private async validateTargets(
    scope: EnvironmentScope,
    input: ReplaceIndividualTargetsInput,
  ): Promise<void> {
    const known = new Set(
      (await this.repository.listVariations(scope.flag.id)).map(
        (variation) => variation.key,
      ),
    );

    for (const target of input.targets) {
      if (!known.has(target.variationKey)) {
        throw ApiError.badRequest(
          `"${target.variationKey}" is not one of the flag's variations.`,
        );
      }
    }
  }

  private async requireConfig(
    flagId: string,
    environmentId: string,
  ): Promise<EnvironmentScope["config"]> {
    const config = await this.repository.findConfig(flagId, environmentId);

    if (!config) {
      throw ApiError.notFound("Flag configuration not found.");
    }

    return config;
  }

  private async requireFlag(
    projectId: string,
    flagKey: string,
  ): Promise<FlagRow> {
    const row = await this.repository.findByKey(projectId, flagKey);

    if (!row) {
      throw ApiError.notFound("Flag not found.");
    }

    return row;
  }

  private async requireEnvironment(
    projectId: string,
    environmentKey: string,
  ): Promise<EnvironmentRef> {
    const environment = await this.repository.findEnvironmentByKey(
      projectId,
      environmentKey,
    );

    if (!environment) {
      throw ApiError.notFound("Environment not found.");
    }

    return environment;
  }
}
