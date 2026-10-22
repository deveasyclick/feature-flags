import type { EvaluateRequest, EvaluationResult } from "@iwifunni/contracts";
import { evaluate as evaluateFlag, OFF_VARIATION } from "@iwifunni/engine";

import type { EvaluationRepository } from "./evaluation.repository.js";
import type { ProjectAccessService } from "../project-access/index.js";

export interface EvaluationActorContext {
  organizationId: string;
  userId: string;
  workspaceRole: string;
}

/**
 * The same endpoint the SDK and the dashboard's debugger call. It reads and
 * decides; nothing is written and no cache sits in front of it.
 */
export class EvaluationService {
  constructor(
    private readonly repository: EvaluationRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async evaluate(
    context: EvaluationActorContext,
    input: EvaluateRequest,
  ): Promise<EvaluationResult> {
    const projectIds = await this.projectAccess.visibleProjectIds(context);
    const target = await this.repository.findTarget(
      context.organizationId,
      {
        projectKey: input.projectKey,
        flagKey: input.flag,
        environmentKey: input.environment,
      },
      projectIds,
    );

    if (!target) {
      return {
        flag: input.flag,
        enabled: false,
        variation: OFF_VARIATION,
        reason: "flag_not_found",
        matchedRuleId: null,
      };
    }

    return evaluateFlag({
      flag: { key: target.flagKey, status: target.flagStatus },
      config: target.config,
      rules: target.rules,
      targets: target.targets,
      segments: target.segments,
      subject: input.user,
    });
  }
}
