import { and, asc, count, eq, ilike, or, inArray, isNull } from "drizzle-orm";

import { db } from "../../db/client.js";
import {
  environment,
  project,
  projectMember,
  apiKey,
  scheduledFlagChange,
  flagChangeRequest,
  organization,
  member,
  flag,
  flagVariation,
  flagEnvironmentConfig,
  targetingRule,
  targetingCondition,
  flagIndividualTarget,
  segment,
  segmentCondition,
  flagDependency,
  flagVersion,
} from "../../db/schema/index.js";
import { randomUUID } from "node:crypto";
import { flagRollbackPolicy } from "../../db/schema/index.js";
import type { Transaction } from "../../shared/types/db.js";
import type {
  EnvironmentRef,
  NewProject,
  ProjectDetailRow,
  ProjectRow,
  UpdateProjectRecord,
} from "./projects.types.js";

const detailColumns = {
  id: project.id,
  key: project.key,
  name: project.name,
  description: project.description,
  color: project.color,
  ownerTeam: project.ownerTeam,
  defaultEnvironmentId: project.defaultEnvironmentId,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  archivedAt: project.archivedAt,
};

export class ProjectsRepository {
  async archive(
    tx: Transaction,
    organizationId: string,
    projectId: string,
  ): Promise<void> {
    const now = new Date();
    await tx
      .update(project)
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          eq(project.id, projectId),
          eq(project.organizationId, organizationId),
        ),
      );
    await tx
      .update(apiKey)
      .set({ revokedAt: now })
      .where(and(eq(apiKey.projectId, projectId), isNull(apiKey.revokedAt)));
    await tx
      .update(scheduledFlagChange)
      .set({
        status: "cancelled",
        finishedAt: now,
        failureReason: "Project archived.",
      })
      .where(
        and(
          eq(scheduledFlagChange.projectId, projectId),
          eq(scheduledFlagChange.status, "pending"),
        ),
      );
    await tx
      .update(flagChangeRequest)
      .set({ status: "superseded", updatedAt: now })
      .where(
        and(
          eq(flagChangeRequest.projectId, projectId),
          eq(flagChangeRequest.status, "pending"),
        ),
      );
    await tx
      .update(flagRollbackPolicy)
      .set({
        status: "cancelled",
        finishedAt: now,
        reason: "Project archived.",
      })
      .where(
        and(
          eq(flagRollbackPolicy.projectId, projectId),
          eq(flagRollbackPolicy.status, "armed"),
        ),
      );
  }

  async findOwnedDestination(
    userId: string,
    slug: string,
  ): Promise<{ id: string; slug: string } | null> {
    const [row] = await db
      .select({ id: organization.id, slug: organization.slug })
      .from(organization)
      .innerJoin(member, eq(member.organizationId, organization.id))
      .where(
        and(
          eq(member.userId, userId),
          eq(member.role, "owner"),
          eq(organization.slug, slug),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async cloneConfiguration(
    tx: Transaction,
    sourceProjectId: string,
    targetProjectId: string,
    author: string,
  ): Promise<void> {
    const environments = await tx
      .select()
      .from(environment)
      .where(eq(environment.projectId, sourceProjectId));
    const environmentIds = new Map(
      environments.map((row) => [row.id, randomUUID()]),
    );
    for (const row of environments) {
      const id = environmentIds.get(row.id);
      if (!id) throw new Error("Environment copy has no identifier.");
      await tx.insert(environment).values({
        ...row,
        id,
        projectId: targetProjectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }
    const [source] = await tx
      .select()
      .from(project)
      .where(eq(project.id, sourceProjectId));
    if (source)
      await tx
        .update(project)
        .set({
          description: source.description,
          color: source.color,
          ownerTeam: source.ownerTeam,
          defaultEnvironmentId: source.defaultEnvironmentId
            ? (environmentIds.get(source.defaultEnvironmentId) ?? null)
            : null,
        })
        .where(eq(project.id, targetProjectId));
    const segments = await tx
      .select()
      .from(segment)
      .where(eq(segment.projectId, sourceProjectId));
    for (const row of segments) {
      const id = randomUUID();
      await tx.insert(segment).values({
        ...row,
        id,
        projectId: targetProjectId,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const conditions = await tx
        .select()
        .from(segmentCondition)
        .where(eq(segmentCondition.segmentId, row.id));
      if (conditions.length)
        await tx.insert(segmentCondition).values(
          conditions.map((condition) => ({
            ...condition,
            id: randomUUID(),
            segmentId: id,
          })),
        );
    }
    const flags = await tx
      .select()
      .from(flag)
      .where(eq(flag.projectId, sourceProjectId));
    for (const row of flags) {
      const id = randomUUID();
      await tx.insert(flag).values({
        ...row,
        id,
        projectId: targetProjectId,
        clientVisible: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const variations = await tx
        .select()
        .from(flagVariation)
        .where(eq(flagVariation.flagId, row.id));
      if (variations.length)
        await tx.insert(flagVariation).values(
          variations.map((variation) => ({
            ...variation,
            id: randomUUID(),
            flagId: id,
          })),
        );
      const configs = await tx
        .select()
        .from(flagEnvironmentConfig)
        .where(eq(flagEnvironmentConfig.flagId, row.id));
      for (const config of configs) {
        const environmentId = environmentIds.get(config.environmentId);
        if (!environmentId) throw new Error("Source environment is missing.");
        await tx.insert(flagEnvironmentConfig).values({
          ...config,
          id: randomUUID(),
          flagId: id,
          environmentId,
          enabled: false,
        });
        const rules = await tx
          .select()
          .from(targetingRule)
          .where(
            and(
              eq(targetingRule.flagId, row.id),
              eq(targetingRule.environmentId, config.environmentId),
            ),
          )
          .orderBy(asc(targetingRule.priority));
        const inputs = [];
        for (const rule of rules) {
          const ruleId = randomUUID();
          await tx
            .insert(targetingRule)
            .values({ ...rule, id: ruleId, flagId: id, environmentId });
          const conditions = await tx
            .select()
            .from(targetingCondition)
            .where(eq(targetingCondition.ruleId, rule.id))
            .orderBy(asc(targetingCondition.priority));
          if (conditions.length)
            await tx.insert(targetingCondition).values(
              conditions.map((condition) => ({
                ...condition,
                id: randomUUID(),
                ruleId,
              })),
            );
          inputs.push({
            description: rule.description,
            variation: rule.variationKey,
            segmentKeys: rule.segmentKeys,
            rollout:
              rule.rolloutPercentage === null
                ? null
                : {
                    percentage: rule.rolloutPercentage,
                    bucketBy: rule.bucketBy ?? "userId",
                  },
            conditions: conditions.map((condition) => ({
              attribute: condition.attribute,
              attributeType: condition.attributeType,
              operator: condition.operator,
              values: condition.values,
            })),
          });
        }
        const targets = await tx
          .select()
          .from(flagIndividualTarget)
          .where(
            and(
              eq(flagIndividualTarget.flagId, row.id),
              eq(flagIndividualTarget.environmentId, config.environmentId),
            ),
          );
        if (targets.length)
          await tx.insert(flagIndividualTarget).values(
            targets.map((target) => ({
              ...target,
              id: randomUUID(),
              flagId: id,
              environmentId,
            })),
          );
        await tx.insert(flagVersion).values({
          id: randomUUID(),
          projectId: targetProjectId,
          flagId: id,
          environmentId,
          version: 1,
          author,
          description: "Copied from another project; starts disabled",
          snapshot: {
            state: {
              config: {
                enabled: false,
                offVariation: config.offVariationKey,
                defaultVariation: config.defaultVariationKey,
                rolloutPercentage: config.rolloutPercentage,
                bucketBy: config.bucketBy,
              },
              rules: { rules: inputs },
              targets: {
                targets: targets.map((target) => ({
                  userId: target.userId,
                  variationKey: target.variationKey,
                })),
              },
            },
          },
        });
      }
    }
    const dependencies = await tx
      .select()
      .from(flagDependency)
      .where(eq(flagDependency.projectId, sourceProjectId));
    if (dependencies.length)
      await tx.insert(flagDependency).values(
        dependencies.map((row) => ({
          ...row,
          id: randomUUID(),
          projectId: targetProjectId,
        })),
      );
  }
  async findByKey(
    tx: Transaction,
    organizationId: string,
    key: string,
  ): Promise<ProjectRow | null> {
    const rows = await this.selectByKey(tx, organizationId, key);

    return rows[0] ?? null;
  }

  async countForOrganization(organizationId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(project)
      .where(eq(project.organizationId, organizationId));

    return row?.value ?? 0;
  }

  async insert(tx: Transaction, input: NewProject): Promise<void> {
    await tx.insert(project).values(input);
  }

  /** The workspace list: one query, with the environment count per project. */
  async list(
    organizationId: string,
    search?: string,
    projectIds?: string[] | null,
    includeArchived = false,
  ): Promise<ProjectDetailRow[]> {
    const conditions = [eq(project.organizationId, organizationId)];
    if (!includeArchived) conditions.push(isNull(project.archivedAt));

    if (projectIds) {
      if (projectIds.length === 0) return [];
      conditions.push(inArray(project.id, projectIds));
    }

    if (search) {
      const pattern = `%${search}%`;
      const match = or(
        ilike(project.key, pattern),
        ilike(project.name, pattern),
      );

      if (match) conditions.push(match);
    }

    return db
      .select({
        ...detailColumns,
        environmentCount: count(environment.id),
      })
      .from(project)
      .leftJoin(environment, eq(environment.projectId, project.id))
      .where(and(...conditions))
      .groupBy(project.id)
      .orderBy(asc(project.key));
  }

  async findDetailByKey(
    organizationId: string,
    key: string,
  ): Promise<ProjectDetailRow | null> {
    const rows = await db
      .select({
        ...detailColumns,
        environmentCount: count(environment.id),
      })
      .from(project)
      .leftJoin(environment, eq(environment.projectId, project.id))
      .where(
        and(eq(project.organizationId, organizationId), eq(project.key, key)),
      )
      .groupBy(project.id)
      .limit(1);

    return rows[0] ?? null;
  }

  async update(
    tx: Transaction,
    id: string,
    patch: UpdateProjectRecord,
  ): Promise<void> {
    await tx
      .update(project)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(project.id, id));
  }

  /** Resolves an environment key inside one project, so a foreign key cannot match. */
  async findEnvironmentByKey(
    projectId: string,
    key: string,
  ): Promise<EnvironmentRef | null> {
    const rows = await db
      .select({ id: environment.id, key: environment.key })
      .from(environment)
      .where(
        and(eq(environment.projectId, projectId), eq(environment.key, key)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  /**
   * The creator becomes the project's explicit owner, so the members screen
   * lists somebody and the owner's rights do not depend on the workspace role.
   */
  async insertOwner(
    tx: Transaction,
    record: { id: string; projectId: string; userId: string },
  ): Promise<void> {
    await tx.insert(projectMember).values({ ...record, role: "owner" });
  }

  private async selectByKey(
    tx: Transaction,
    organizationId: string,
    key: string,
  ): Promise<ProjectRow[]> {
    return tx
      .select({
        id: project.id,
        key: project.key,
        name: project.name,
      })
      .from(project)
      .where(
        and(eq(project.organizationId, organizationId), eq(project.key, key)),
      )
      .limit(1);
  }
}
