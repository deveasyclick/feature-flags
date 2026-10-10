import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  ilike,
  inArray,
  or,
  sql,
} from "drizzle-orm";

import type {
  CreateFlagVariationInput,
  FlagIndividualTarget,
  FlagStatus,
  TargetingRuleInput,
  UpdateFlagVariationInput,
} from "@dariise/contracts";

import { db } from "../../db/client.js";
import {
  environment,
  flag,
  flagDependency,
  flagEnvironmentConfig,
  flagIndividualTarget,
  flagVariation,
  flagVersion,
  project,
  targetingCondition,
  targetingRule,
} from "../../db/schema/index.js";
import type { Transaction } from "../../shared/types/db.js";
import type {
  DependencyRow,
  EnvironmentConfigCopyInput,
  EnvironmentRef,
  FlagEnvironmentConfigRow,
  FlagEnvironmentSummaryRow,
  FlagListFilter,
  FlagRow,
  FlagStatusRef,
  FlagVersionRecord,
  FlagVersionSummary,
  IndividualTargetRow,
  NewFlagRecord,
  RuleWithConditions,
  UpdateConfigRecord,
  UpdateFlagRecord,
  VariationReference,
  VariationRow,
  WorkspaceFlagFilter,
} from "./flags.types.js";
import { WORKSPACE_FLAG_CURSOR_SEPARATOR } from "./flags.types.js";

export class FlagsRepository {
  /** Fetches limit + 1 rows so the caller can tell whether another page exists. */
  async list(projectId: string, filter: FlagListFilter): Promise<FlagRow[]> {
    const conditions = [eq(flag.projectId, projectId)];

    if (filter.status) {
      conditions.push(eq(flag.status, filter.status));
    }

    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(ilike(flag.key, pattern), ilike(flag.name, pattern));

      if (match) conditions.push(match);
    }

    if (filter.cursor) {
      conditions.push(gt(flag.key, filter.cursor));
    }

    return db
      .select()
      .from(flag)
      .where(and(...conditions))
      .orderBy(asc(flag.key))
      .limit(filter.limit + 1);
  }

  /**
   * How a page of flags stands in each environment, in one query rather than one
   * per row. Either filter narrows the answer to a single environment.
   */
  async listEnvironmentSummaries(
    flagIds: string[],
    filter: { environmentId?: string; environmentKey?: string } = {},
  ): Promise<Array<{ flagId: string } & FlagEnvironmentSummaryRow>> {
    if (flagIds.length === 0) return [];

    const conditions = [inArray(flagEnvironmentConfig.flagId, flagIds)];

    if (filter.environmentId) {
      conditions.push(eq(flagEnvironmentConfig.environmentId, filter.environmentId));
    }

    if (filter.environmentKey) {
      conditions.push(eq(environment.key, filter.environmentKey));
    }

    return db
      .select({
        flagId: flagEnvironmentConfig.flagId,
        environmentKey: environment.key,
        environmentName: environment.name,
        enabled: flagEnvironmentConfig.enabled,
        rolloutPercentage: flagEnvironmentConfig.rolloutPercentage,
      })
      .from(flagEnvironmentConfig)
      .innerJoin(
        environment,
        eq(environment.id, flagEnvironmentConfig.environmentId),
      )
      .where(and(...conditions))
      .orderBy(asc(environment.createdAt), asc(environment.key));
  }

  async findByKey(projectId: string, key: string): Promise<FlagRow | null> {
    const rows = await db
      .select()
      .from(flag)
      .where(and(eq(flag.projectId, projectId), eq(flag.key, key)))
      .limit(1);

    return rows[0] ?? null;
  }

  /** Every flag of one project, read inside a transaction that configures them. */
  async listForProject(
    tx: Transaction,
    projectId: string,
  ): Promise<FlagRow[]> {
    return tx
      .select()
      .from(flag)
      .where(eq(flag.projectId, projectId))
      .orderBy(asc(flag.key));
  }

  /** Every environment of one project, for the eager configuration of a new flag. */
  async listEnvironments(projectId: string): Promise<EnvironmentRef[]> {
    return db
      .select({
        id: environment.id,
        key: environment.key,
        name: environment.name,
        isProtected: environment.isProtected,
        archivedAt: environment.archivedAt,
      })
      .from(environment)
      .where(eq(environment.projectId, projectId))
      .orderBy(asc(environment.createdAt), asc(environment.key));
  }

  async findEnvironmentByKey(
    projectId: string,
    key: string,
  ): Promise<EnvironmentRef | null> {
    const rows = await db
      .select({
        id: environment.id,
        key: environment.key,
        name: environment.name,
        isProtected: environment.isProtected,
        archivedAt: environment.archivedAt,
      })
      .from(environment)
      .where(
        and(eq(environment.projectId, projectId), eq(environment.key, key)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findConfig(
    flagId: string,
    environmentId: string,
  ): Promise<FlagEnvironmentConfigRow | null> {
    const rows = await db
      .select()
      .from(flagEnvironmentConfig)
      .where(
        and(
          eq(flagEnvironmentConfig.flagId, flagId),
          eq(flagEnvironmentConfig.environmentId, environmentId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /** Read inside a transaction, so a copy sees the rows it is about to write. */
  async findConfigInTx(
    tx: Transaction,
    flagId: string,
    environmentId: string,
  ): Promise<FlagEnvironmentConfigRow | null> {
    const rows = await tx
      .select()
      .from(flagEnvironmentConfig)
      .where(
        and(
          eq(flagEnvironmentConfig.flagId, flagId),
          eq(flagEnvironmentConfig.environmentId, environmentId),
        ),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async insert(tx: Transaction, record: NewFlagRecord): Promise<void> {
    await tx.insert(flag).values(record);
  }

  async update(
    tx: Transaction,
    id: string,
    patch: UpdateFlagRecord,
  ): Promise<void> {
    await tx
      .update(flag)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(flag.id, id));
  }

  async setStatus(
    tx: Transaction,
    id: string,
    status: FlagStatus,
  ): Promise<void> {
    await tx
      .update(flag)
      .set({ status, updatedAt: new Date() })
      .where(eq(flag.id, id));
  }

  async insertConfig(
    tx: Transaction,
    input: {
      flagId: string;
      environmentId: string;
      enabled?: boolean;
      offVariationKey?: string;
      defaultVariationKey?: string;
      rolloutPercentage?: number;
      bucketBy?: string;
    },
  ): Promise<string> {
    const id = randomUUID();

    await tx.insert(flagEnvironmentConfig).values({
      id,
      flagId: input.flagId,
      environmentId: input.environmentId,
      enabled: input.enabled ?? false,
      offVariationKey: input.offVariationKey ?? "off",
      defaultVariationKey: input.defaultVariationKey ?? "on",
      rolloutPercentage: input.rolloutPercentage ?? 0,
      bucketBy: input.bucketBy ?? "userId",
    });

    return id;
  }

  async updateConfig(
    tx: Transaction,
    configId: string,
    record: UpdateConfigRecord,
  ): Promise<void> {
    await tx
      .update(flagEnvironmentConfig)
      .set({
        enabled: record.enabled,
        offVariationKey: record.offVariation,
        defaultVariationKey: record.defaultVariation,
        rolloutPercentage: record.rolloutPercentage,
        bucketBy: record.bucketBy,
        updatedAt: new Date(),
      })
      .where(eq(flagEnvironmentConfig.id, configId));
  }

  /**
   * The two variations a flag starts with, in order. The values have to fit the
   * flag's declared type — a `string` flag serving `true` would break the promise
   * its type makes to the SDK — and the caller decides the keys, which a string
   * flag may name for itself.
   */
  async insertVariations(
    tx: Transaction,
    input: {
      flagId: string;
      variations: Array<{ key: string; name: string; value: unknown }>;
    },
  ): Promise<void> {
    await tx.insert(flagVariation).values(
      input.variations.map((variation, index) => ({
        id: randomUUID(),
        flagId: input.flagId,
        key: variation.key,
        name: variation.name,
        value: variation.value,
        priority: index,
      })),
    );
  }

  async listVariations(flagId: string): Promise<VariationRow[]> {
    return db
      .select({
        flagId: flagVariation.flagId,
        key: flagVariation.key,
        name: flagVariation.name,
        value: flagVariation.value,
        description: flagVariation.description,
        priority: flagVariation.priority,
      })
      .from(flagVariation)
      .where(eq(flagVariation.flagId, flagId))
      .orderBy(asc(flagVariation.priority));
  }

  async insertVariation(
    tx: Transaction,
    input: { flagId: string; variation: CreateFlagVariationInput },
  ): Promise<void> {
    const [row] = await tx
      .select({
        next: sql<number>`coalesce(max(${flagVariation.priority}), -1) + 1`,
      })
      .from(flagVariation)
      .where(eq(flagVariation.flagId, input.flagId));

    await tx.insert(flagVariation).values({
      id: randomUUID(),
      flagId: input.flagId,
      key: input.variation.key,
      name: input.variation.name,
      value: input.variation.value,
      description: input.variation.description ?? null,
      priority: Number(row?.next ?? 0),
    });
  }

  async updateVariation(
    tx: Transaction,
    flagId: string,
    key: string,
    patch: UpdateFlagVariationInput,
  ): Promise<void> {
    await tx
      .update(flagVariation)
      .set({
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.value === undefined ? {} : { value: patch.value }),
        ...(patch.description === undefined
          ? {}
          : { description: patch.description }),
        updatedAt: new Date(),
      })
      .where(
        and(eq(flagVariation.flagId, flagId), eq(flagVariation.key, key)),
      );
  }

  async deleteVariation(
    tx: Transaction,
    flagId: string,
    key: string,
  ): Promise<void> {
    await tx
      .delete(flagVariation)
      .where(
        and(eq(flagVariation.flagId, flagId), eq(flagVariation.key, key)),
      );
  }

  /** Everything that would break if this variation key disappeared. */
  async findVariationReferences(
    flagId: string,
    variationKey: string,
  ): Promise<VariationReference[]> {
    const configs = await db
      .select({
        environmentKey: environment.key,
        offVariationKey: flagEnvironmentConfig.offVariationKey,
        defaultVariationKey: flagEnvironmentConfig.defaultVariationKey,
      })
      .from(flagEnvironmentConfig)
      .innerJoin(
        environment,
        eq(environment.id, flagEnvironmentConfig.environmentId),
      )
      .where(eq(flagEnvironmentConfig.flagId, flagId));

    const rules = await db
      .select({
        environmentKey: environment.key,
        id: targetingRule.id,
        description: targetingRule.description,
      })
      .from(targetingRule)
      .innerJoin(environment, eq(environment.id, targetingRule.environmentId))
      .where(
        and(
          eq(targetingRule.flagId, flagId),
          eq(targetingRule.variationKey, variationKey),
        ),
      );

    const targets = await db
      .select({
        environmentKey: environment.key,
        userId: flagIndividualTarget.userId,
      })
      .from(flagIndividualTarget)
      .innerJoin(
        environment,
        eq(environment.id, flagIndividualTarget.environmentId),
      )
      .where(
        and(
          eq(flagIndividualTarget.flagId, flagId),
          eq(flagIndividualTarget.variationKey, variationKey),
        ),
      );

    const references: VariationReference[] = [];

    for (const config of configs) {
      if (config.offVariationKey === variationKey) {
        references.push({
          environmentKey: config.environmentKey,
          kind: "off_variation",
          detail: null,
        });
      }

      if (config.defaultVariationKey === variationKey) {
        references.push({
          environmentKey: config.environmentKey,
          kind: "default_variation",
          detail: null,
        });
      }
    }

    for (const rule of rules) {
      references.push({
        environmentKey: rule.environmentKey,
        kind: "rule",
        detail: rule.description ?? rule.id,
      });
    }

    for (const target of targets) {
      references.push({
        environmentKey: target.environmentKey,
        kind: "target",
        detail: target.userId,
      });
    }

    return references;
  }

  /** One past the highest version this environment's history already has. */
  async nextVersion(
    tx: Transaction,
    flagId: string,
    environmentId: string,
  ): Promise<number> {
    const [row] = await tx
      .select({
        next: sql<number>`coalesce(max(${flagVersion.version}), 0) + 1`,
      })
      .from(flagVersion)
      .where(
        and(
          eq(flagVersion.flagId, flagId),
          eq(flagVersion.environmentId, environmentId),
        ),
      );

    return Number(row?.next ?? 1);
  }

  async insertVersion(
    tx: Transaction,
    record: FlagVersionRecord,
  ): Promise<void> {
    await tx.insert(flagVersion).values({
      id: randomUUID(),
      ...record,
    });
  }

  async listVersions(
    flagId: string,
    environmentId: string,
    limit: number,
    cursor: string | null,
  ): Promise<FlagVersionSummary[]> {
    const conditions = [
      eq(flagVersion.flagId, flagId),
      eq(flagVersion.environmentId, environmentId),
    ];

    if (cursor) {
      conditions.push(sql`${flagVersion.version} < ${Number(cursor)}`);
    }

    return db
      .select({
        version: flagVersion.version,
        description: flagVersion.description,
        author: flagVersion.author,
        snapshot: flagVersion.snapshot,
        createdAt: flagVersion.createdAt,
      })
      .from(flagVersion)
      .where(and(...conditions))
      .orderBy(sql`${flagVersion.version} desc`)
      .limit(limit + 1);
  }

  async listRules(
    flagId: string,
    environmentId: string,
  ): Promise<RuleWithConditions[]> {
    const rules = await db
      .select({
        id: targetingRule.id,
        flagId: targetingRule.flagId,
        environmentId: targetingRule.environmentId,
        priority: targetingRule.priority,
        description: targetingRule.description,
        variationKey: targetingRule.variationKey,
        segmentKeys: targetingRule.segmentKeys,
        rolloutPercentage: targetingRule.rolloutPercentage,
        bucketBy: targetingRule.bucketBy,
      })
      .from(targetingRule)
      .where(
        and(
          eq(targetingRule.flagId, flagId),
          eq(targetingRule.environmentId, environmentId),
        ),
      )
      .orderBy(asc(targetingRule.priority));

    if (rules.length === 0) return [];

    const conditions = await db
      .select({
        id: targetingCondition.id,
        ruleId: targetingCondition.ruleId,
        attribute: targetingCondition.attribute,
        attributeType: targetingCondition.attributeType,
        operator: targetingCondition.operator,
        values: targetingCondition.values,
        priority: targetingCondition.priority,
      })
      .from(targetingCondition)
      .where(
        inArray(
          targetingCondition.ruleId,
          rules.map((rule) => rule.id),
        ),
      )
      .orderBy(asc(targetingCondition.priority));

    return rules.map((rule) => ({
      rule,
      conditions: conditions.filter(
        (condition) => condition.ruleId === rule.id,
      ),
    }));
  }

  /** Replaces one environment's whole ordered rule set: order is the array's order. */
  async replaceRules(
    tx: Transaction,
    flagId: string,
    environmentId: string,
    rules: TargetingRuleInput[],
  ): Promise<void> {
    await tx
      .delete(targetingRule)
      .where(
        and(
          eq(targetingRule.flagId, flagId),
          eq(targetingRule.environmentId, environmentId),
        ),
      );

    for (const [index, rule] of rules.entries()) {
      const ruleId = randomUUID();

      await tx.insert(targetingRule).values({
        id: ruleId,
        flagId,
        environmentId,
        priority: index,
        description: rule.description ?? null,
        variationKey: rule.variation,
        segmentKeys: rule.segmentKeys,
        rolloutPercentage: rule.rollout?.percentage ?? null,
        bucketBy: rule.rollout?.bucketBy ?? null,
      });

      if (rule.conditions.length === 0) continue;

      await tx.insert(targetingCondition).values(
        rule.conditions.map((condition, conditionIndex) => ({
          id: randomUUID(),
          ruleId,
          attribute: condition.attribute,
          attributeType: condition.attributeType,
          operator: condition.operator,
          values: condition.values,
          priority: conditionIndex,
        })),
      );
    }
  }

  async listTargets(
    flagId: string,
    environmentId: string,
  ): Promise<IndividualTargetRow[]> {
    return db
      .select({
        flagId: flagIndividualTarget.flagId,
        environmentId: flagIndividualTarget.environmentId,
        userId: flagIndividualTarget.userId,
        variationKey: flagIndividualTarget.variationKey,
      })
      .from(flagIndividualTarget)
      .where(
        and(
          eq(flagIndividualTarget.flagId, flagId),
          eq(flagIndividualTarget.environmentId, environmentId),
        ),
      );
  }

  async replaceTargets(
    tx: Transaction,
    flagId: string,
    environmentId: string,
    targets: FlagIndividualTarget[],
  ): Promise<void> {
    await tx
      .delete(flagIndividualTarget)
      .where(
        and(
          eq(flagIndividualTarget.flagId, flagId),
          eq(flagIndividualTarget.environmentId, environmentId),
        ),
      );

    if (targets.length === 0) return;

    await tx.insert(flagIndividualTarget).values(
      targets.map((target) => ({
        id: randomUUID(),
        flagId,
        environmentId,
        userId: target.userId,
        variationKey: target.variationKey,
      })),
    );
  }

  /** Every rule and target of one flag in one environment, for the detail read. */
  async detailParts(
    flagId: string,
    environmentId: string,
  ): Promise<{ rules: RuleWithConditions[]; targets: IndividualTargetRow[] }> {
    const [rules, targets] = await Promise.all([
      this.listRules(flagId, environmentId),
      this.listTargets(flagId, environmentId),
    ]);

    return { rules, targets };
  }

  async listDependencies(
    projectId: string,
    flagKey: string,
  ): Promise<DependencyRow[]> {
    return db
      .select({
        key: flagDependency.key,
        requires: flagDependency.requires,
        referencedIn: flagDependency.referencedIn,
      })
      .from(flagDependency)
      .where(
        and(
          eq(flagDependency.projectId, projectId),
          or(
            eq(flagDependency.key, flagKey),
            eq(flagDependency.requires, flagKey),
          ),
        ),
      );
  }

  async findStatuses(
    projectId: string,
    keys: string[],
  ): Promise<FlagStatusRef[]> {
    if (keys.length === 0) return [];

    return db
      .select({ key: flag.key, status: flag.status })
      .from(flag)
      .where(and(eq(flag.projectId, projectId), inArray(flag.key, keys)));
  }

  /** The workspace-wide list: every project in the session's workspace. */
  async listForWorkspace(
    organizationId: string,
    filter: WorkspaceFlagFilter,
  ): Promise<Array<FlagRow & { projectKey: string }>> {
    const conditions = [eq(project.organizationId, organizationId)];

    if (filter.projectKey) {
      conditions.push(eq(project.key, filter.projectKey));
    }

    if (filter.status) {
      conditions.push(eq(flag.status, filter.status));
    }

    if (filter.search) {
      const pattern = `%${filter.search}%`;
      const match = or(ilike(flag.key, pattern), ilike(flag.name, pattern));

      if (match) conditions.push(match);
    }

    if (filter.cursor) {
      // Ordered by (project key, flag key), so the cursor holds both and the
      // comparison is the same tuple comparison the SQL does.
      const [cursorProject, cursorFlag] =
        filter.cursor.split(WORKSPACE_FLAG_CURSOR_SEPARATOR);

      if (cursorProject && cursorFlag) {
        conditions.push(
          sql`(${project.key}, ${flag.key}) > (${cursorProject}, ${cursorFlag})`,
        );
      }
    }

    return db
      .select({ ...getTableColumns(flag), projectKey: project.key })
      .from(flag)
      .innerJoin(project, eq(project.id, flag.projectId))
      .where(and(...conditions))
      .orderBy(asc(project.key), asc(flag.key))
      .limit(filter.limit + 1);
  }

  /**
   * The one configuration copy primitive: enabled, selections, rollout, rules
   * and individual targets move together, inside the caller's transaction. The
   * flag's variations are shared, so they are not copied.
   */
  async copyConfigIntoEnvironment(
    tx: Transaction,
    input: EnvironmentConfigCopyInput,
  ): Promise<string> {
    const [source] = await tx
      .select()
      .from(flagEnvironmentConfig)
      .where(
        and(
          eq(flagEnvironmentConfig.flagId, input.sourceFlagId),
          eq(flagEnvironmentConfig.environmentId, input.sourceEnvironmentId),
        ),
      )
      .limit(1);

    if (!source) {
      throw new Error("The configuration to copy no longer exists.");
    }

    const targetId = randomUUID();

    await tx.insert(flagEnvironmentConfig).values({
      id: targetId,
      flagId: source.flagId,
      environmentId: input.targetEnvironmentId,
      enabled: source.enabled,
      offVariationKey: source.offVariationKey,
      defaultVariationKey: source.defaultVariationKey,
      rolloutPercentage: source.rolloutPercentage,
      bucketBy: source.bucketBy,
    });

    const rules = await tx
      .select()
      .from(targetingRule)
      .where(
        and(
          eq(targetingRule.flagId, source.flagId),
          eq(targetingRule.environmentId, input.sourceEnvironmentId),
        ),
      )
      .orderBy(asc(targetingRule.priority));

    for (const rule of rules) {
      const ruleId = randomUUID();

      await tx.insert(targetingRule).values({
        id: ruleId,
        flagId: source.flagId,
        environmentId: input.targetEnvironmentId,
        priority: rule.priority,
        description: rule.description,
        variationKey: rule.variationKey,
        segmentKeys: rule.segmentKeys,
        rolloutPercentage: rule.rolloutPercentage,
        bucketBy: rule.bucketBy,
      });

      const conditions = await tx
        .select()
        .from(targetingCondition)
        .where(eq(targetingCondition.ruleId, rule.id))
        .orderBy(asc(targetingCondition.priority));

      if (conditions.length === 0) continue;

      await tx.insert(targetingCondition).values(
        conditions.map((condition) => ({
          id: randomUUID(),
          ruleId,
          attribute: condition.attribute,
          attributeType: condition.attributeType,
          operator: condition.operator,
          values: condition.values,
          priority: condition.priority,
        })),
      );
    }

    const targets = await tx
      .select()
      .from(flagIndividualTarget)
      .where(
        and(
          eq(flagIndividualTarget.flagId, source.flagId),
          eq(
            flagIndividualTarget.environmentId,
            input.sourceEnvironmentId,
          ),
        ),
      );

    if (targets.length > 0) {
      await tx.insert(flagIndividualTarget).values(
        targets.map((target) => ({
          id: randomUUID(),
          flagId: source.flagId,
          environmentId: input.targetEnvironmentId,
          userId: target.userId,
          variationKey: target.variationKey,
        })),
      );
    }

    return targetId;
  }
}
