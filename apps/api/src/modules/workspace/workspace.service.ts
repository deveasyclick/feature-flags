import type {
  UpdateWorkspaceInput,
  UpdateWorkspaceSecurityInput,
  WorkspaceProfile,
  WorkspaceSecuritySettings,
} from "@iwifunni/contracts";

import { ApiError } from "../../shared/http/errors.js";
import { parseMetadata, toSecuritySettings, toWorkspaceProfile } from "./workspace.mapper.js";
import type { WorkspaceRepository } from "./workspace.repository.js";
import type { WorkspaceActorContext, WorkspaceMetadata } from "./workspace.types.js";

/** Workspace settings are owner/admin-only; every member may read them. */
const MANAGING_ROLES = new Set(["owner", "admin"]);

export class WorkspaceService {
  constructor(private readonly repository: WorkspaceRepository) {}

  async getProfile(
    context: WorkspaceActorContext,
  ): Promise<WorkspaceProfile> {
    const row = await this.requireWorkspace(context.organizationId);

    return toWorkspaceProfile(row, parseMetadata(row.metadata));
  }

  async updateProfile(
    context: WorkspaceActorContext,
    input: UpdateWorkspaceInput,
  ): Promise<WorkspaceProfile> {
    this.assertCanManage(context);

    const row = await this.requireWorkspace(context.organizationId);
    const metadata: WorkspaceMetadata = parseMetadata(row.metadata);

    if (input.name !== undefined) {
      await this.repository.updateName(row.id, input.name);
    }

    if (input.defaultEnvironmentKey !== undefined) {
      if (input.defaultEnvironmentKey === null) {
        metadata.defaultEnvironmentId = null;
      } else {
        const environment = await this.repository.findEnvironmentByKey(
          row.id,
          input.defaultEnvironmentKey,
        );

        if (!environment) {
          throw ApiError.badRequest(
            `"${input.defaultEnvironmentKey}" is not an environment in this workspace.`,
          );
        }

        metadata.defaultEnvironmentId = environment.id;
      }
    }

    if (input.timezone !== undefined) {
      metadata.timezone = input.timezone;
    }

    await this.repository.updateMetadata(row.id, JSON.stringify(metadata));

    const updated = await this.requireWorkspace(context.organizationId);

    return toWorkspaceProfile(updated, metadata);
  }

  async getSecurity(
    context: WorkspaceActorContext,
  ): Promise<WorkspaceSecuritySettings> {
    const row = await this.requireWorkspace(context.organizationId);

    return toSecuritySettings(parseMetadata(row.metadata));
  }

  async updateSecurity(
    context: WorkspaceActorContext,
    input: UpdateWorkspaceSecurityInput,
  ): Promise<WorkspaceSecuritySettings> {
    this.assertCanManage(context);

    const row = await this.requireWorkspace(context.organizationId);
    const metadata = parseMetadata(row.metadata);
    const security = { ...toSecuritySettings(metadata), ...input };

    metadata.security = security;
    await this.repository.updateMetadata(row.id, JSON.stringify(metadata));

    return security;
  }

  private assertCanManage(context: WorkspaceActorContext): void {
    if (!MANAGING_ROLES.has(context.workspaceRole)) {
      throw ApiError.forbidden(
        "Only a workspace owner or admin can change workspace settings.",
      );
    }
  }

  private async requireWorkspace(organizationId: string) {
    const row = await this.repository.findById(organizationId);

    if (!row) {
      throw ApiError.notFound("No workspace found for this account.");
    }

    return row;
  }
}
