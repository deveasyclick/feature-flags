import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  eq,
  getTableColumns,
  gt,
  gte,
  ilike,
  inArray,
  lte,
  isNull,
  or,
  sql,
} from "drizzle-orm";

import type {
  CreateFlagVariationInput,
  FlagIndividualTarget,
  FlagStatus,
  TargetingRuleInput,
  UpdateFlagVariationInput,
} from "@iwifunni/contracts";

import { db, type Database } from "../../db/client.js";
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
  scheduledFlagChange,
  flagRollbackPolicy,
  evaluationEvent,
  member,
  user,
} from "../../db/schema/index.js";
import type { Transaction } from "../../shared/types/db.js";
import type {
  NewScheduledFlagChange,
  ScheduledFlagChangeRow,
  FlagRollbackRow,
  NewFlagRollback,
} from "./flags.types.js";
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
  async insertRollback(
    tx: Transaction,
    input: NewFlagRollback,
  ): Promise<FlagRollbackRow> {
    const [row] = await tx.insert(flagRollbackPolicy).values(input).returning();
    if (!row) throw new Error("Rollback policy was not inserted.");
    return row;
  }
  async hasArmedRollback(
    tx: Transaction,
    flagId: string,
    environmentId: string,
  ): Promise<boolean> {
    const [row] = await tx
      .select({ id: flagRollbackPolicy.id })
      .from(flagRollbackPolicy)
      .where(
        and(
          eq(flagRollbackPolicy.flagId, flagId),
          eq(flagRollbackPolicy.environmentId, environmentId),
          eq(flagRollbackPolicy.status, "armed"),
        ),
      )
      .limit(1);
    return !!row;
  }
  async listRollbacks(
    flagId: string,
    environmentId: string,
    limit: number,
    cursor: string | null,
  ): Promise<FlagRollbackRow[]> {
    return db
      .select()
      .from(flagRollbackPolicy)
      .where(
        and(
          eq(flagRollbackPolicy.flagId, flagId),
          eq(flagRollbackPolicy.environmentId, environmentId),
          cursor ? gt(flagRollbackPolicy.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(flagRollbackPolicy.id))
      .limit(limit + 1);
  }
  async cancelRollback(
    tx: Transaction,
    flagId: string,
    environmentId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await tx
      .update(flagRollbackPolicy)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(flagRollbackPolicy.id, id),
          eq(flagRollbackPolicy.flagId, flagId),
          eq(flagRollbackPolicy.environmentId, environmentId),
          eq(flagRollbackPolicy.status, "armed"),
        ),
      )
      .returning({ id: flagRollbackPolicy.id });
    return rows.length > 0;
  }
  async claimRollback(
    tx: Transaction,
    now: Date,
  ): Promise<FlagRollbackRow | null> {
    const [row] = await tx
      .select()
      .from(flagRollbackPolicy)
      .where(
        and(
          eq(flagRollbackPolicy.status, "armed"),
          or(
            isNull(flagRollbackPolicy.checkedAt),
            lte(flagRollbackPolicy.checkedAt, new Date(now.getTime() - 15_000)),
          ),
        ),
      )
      .orderBy(sql`${flagRollbackPolicy.checkedAt} asc nulls first`)
      .limit(1)
      .for("update", { skipLocked: true });
    if (!row) return null;
    await tx
      .update(flagRollbackPolicy)
      .set({ checkedAt: now })
      .where(eq(flagRollbackPolicy.id, row.id));
    return row;
  }
  async finishRollback(
    tx: Transaction,
    id: string,
    status: "triggered" | "blocked" | "expired",
    reason: string,
  ): Promise<void> {
    await tx
      .update(flagRollbackPolicy)
      .set({ status, reason, finishedAt: new Date() })
      .where(eq(flagRollbackPolicy.id, id));
  }
  async rollbackObservations(
    tx: Transaction,
    row: FlagRollbackRow,
    flagKey: string,
    now: Date,
  ): Promise<{ total: number; errors: number }> {
    const since = new Date(
      Math.max(
        row.armedAt.getTime(),
        now.getTime() - row.windowMinutes * 60_000,
      ),
    );
    const [counts] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        errors: sql<number>`count(*) filter (where ${evaluationEvent.outcome} = 'error')::int`,
      })
      .from(evaluationEvent)
      .where(
        and(
          eq(evaluationEvent.projectId, row.projectId),
          eq(evaluationEvent.environmentId, row.environmentId),
          eq(evaluationEvent.flagKey, flagKey),
          eq(evaluationEvent.flagVersion, row.currentVersion),
          eq(evaluationEvent.kind, "outcome"),
          gte(evaluationEvent.createdAt, since),
          lte(evaluationEvent.createdAt, now),
        ),
      );
    return counts ?? { total: 0, errors: 0 };
  }
  async clientVisibility(flagId: string): Promise<boolean> {
    const [row] = await db
      .select({ clientVisible: flag.clientVisible })
      .from(flag)
      .where(eq(flag.id, flagId))
      .limit(1);
    return row?.clientVisible ?? false;
  }

  async setClientVisibility(
    tx: Transaction,
    flagId: string,
    clientVisible: boolean,
  ): Promise<void> {
    await tx
      .update(flag)
      .set({ clientVisible, updatedAt: new Date() })
      .where(eq(flag.id, flagId));
  }
  async insertSchedule(
    tx: Transaction,
    record: NewScheduledFlagChange,
  ): Promise<ScheduledFlagChangeRow> {
    const [row] = await tx
      .insert(scheduledFlagChange)
      .values(record)
      .returning();
    if (!row) throw new Error("Scheduled change was not inserted.");
    return row;
  }

  async listSchedules(
    flagId: string,
    environmentId: string,
    limit: number,
    cursor: string | null,
  ): Promise<ScheduledFlagChangeRow[]> {
    return db
      .select()
      .from(scheduledFlagChange)
      .where(
        and(
          eq(scheduledFlagChange.flagId, flagId),
          eq(scheduledFlagChange.environmentId, environmentId),
          cursor ? gt(scheduledFlagChange.id, cursor) : undefined,
        ),
      )
      .orderBy(asc(scheduledFlagChange.id))
      .limit(limit + 1);
  }

  async cancelSchedule(
    tx: Transaction,
    flagId: string,
    environmentId: string,
    id: string,
  ): Promise<boolean> {
    const rows = await tx
      .update(scheduledFlagChange)
      .set({ status: "cancelled", finishedAt: new Date() })
      .where(
        and(
          eq(scheduledFlagChange.id, id),
          eq(scheduledFlagChange.flagId, flagId),
          eq(scheduledFlagChange.environmentId, environmentId),
          eq(scheduledFlagChange.status, "pending"),
        ),
      )
      .returning({ id: scheduledFlagChange.id });
    return rows.length > 0;
  }

  async claimDueSchedule(
    tx: Transaction,
    now: Date,
  ): Promise<ScheduledFlagChangeRow | null> {
    const [row] = await tx
      .select()
      .from(scheduledFlagChange)
      .where(
        and(
          eq(scheduledFlagChange.status, "pending"),
          lte(scheduledFlagChange.executeAt, now),
        ),
      )
      .orderBy(asc(scheduledFlagChange.executeAt))
      .limit(1)
      .for("update", { skipLocked: true });
    return row ?? null;
  }

  async finishSchedule(
    tx: Transaction,
    id: string,
    failureReason: string | null,
  ): Promise<void> {
    await tx
      .update(scheduledFlagChange)
      .set({
        status: failureReason ? "failed" : "completed",
        failureReason,
        finishedAt: new Date(),
      })
      .where(eq(scheduledFlagChange.id, id));
  }

  async scheduleActor(
    organizationId: string,
    userId: string,
  ): Promise<{ workspaceRole: string; userName: string } | null> {
    const [row] = await db
      .select({ workspaceRole: member.role, userName: user.name })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async scheduleKeys(
    tx: Transaction,
    row: Pick<
      ScheduledFlagChangeRow,
      "organizationId" | "projectId" | "flagId" | "environmentId"
    >,
  ): Promise<{
    projectKey: string;
    flagKey: string;
    environmentKey: string;
  } | null> {
    const [keys] = await tx
      .select({
        projectKey: project.key,
        flagKey: flag.key,
        environmentKey: environment.key,
      })
      .from(project)
      .innerJoin(
        flag,
        and(eq(flag.projectId, project.id), eq(flag.id, row.flagId)),
      )
      .innerJoin(
        environment,
        and(
          eq(environment.projectId, project.id),
          eq(environment.id, row.environmentId),
        ),
      )
      .where(
        and(
          eq(project.id, row.projectId),
          eq(project.organizationId, row.organizationId),
        ),
      )
      .limit(1);
    return keys ?? null;
  }
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
      conditions.push(
        eq(flagEnvironmentConfig.environmentId, filter.environmentId),
      );
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
  async listForProject(tx: Transaction, projectId: string): Promise<FlagRow[]> {
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
      .where(and(eq(flagVariation.flagId, flagId), eq(flagVariation.key, key)));
  }

  async deleteVariation(
    tx: Transaction,
    flagId: string,
    key: string,
  ): Promise<void> {
    await tx
      .delete(flagVariation)
      .where(and(eq(flagVariation.flagId, flagId), eq(flagVariation.key, key)));
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

  async findVersion(
    flagId: string,
    environmentId: string,
    version: number,
  ): Promise<FlagVersionSummary | null> {
    const [row] = await db
      .select()
      .from(flagVersion)
      .where(
        and(
          eq(flagVersion.flagId, flagId),
          eq(flagVersion.environmentId, environmentId),
          eq(flagVersion.version, version),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async lockConfig(
    tx: Transaction,
    flagId: string,
    environmentId: string,
  ): Promise<void> {
    await tx
      .select({ flagId: flagEnvironmentConfig.flagId })
      .from(flagEnvironmentConfig)
      .where(
        and(
          eq(flagEnvironmentConfig.flagId, flagId),
          eq(flagEnvironmentConfig.environmentId, environmentId),
        ),
      )
      .for("update");
  }

  async listRules(
    flagId: string,
    environmentId: string,
    connection: Database | Transaction = db,
  ): Promise<RuleWithConditions[]> {
    const rules = await connection
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

    const conditions = await connection
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
    connection: Database | Transaction = db,
  ): Promise<IndividualTargetRow[]> {
    return connection
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
    const conditions = [
      eq(project.organizationId, organizationId),
      isNull(project.archivedAt),
    ];

    if (filter.projectIds) {
      if (filter.projectIds.length === 0) return [];
      conditions.push(inArray(project.id, filter.projectIds));
    }

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
      const [cursorProject, cursorFlag] = filter.cursor.split(
        WORKSPACE_FLAG_CURSOR_SEPARATOR,
      );

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
          eq(flagIndividualTarget.environmentId, input.sourceEnvironmentId),
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
