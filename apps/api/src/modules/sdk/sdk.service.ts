import {
  SDK_API_KEY_KINDS,
  type SdkConfig,
  type SdkFlag,
  type SdkSegment,
} from "@iwifunni/contracts";
import { sha256, utf8Bytes } from "@iwifunni/engine";

import { ApiError } from "../../shared/http/errors.js";
import type { ApiKeyAccessContext } from "../api-keys/index.js";
import {
  toConfig,
  toFlag,
  toRule,
  toSegment,
  toTarget,
} from "./sdk.mapper.js";
import type { SdkRepository } from "./sdk.repository.js";
import type { SdkMeta } from "./sdk.types.js";

/** How many hex characters of the payload digest name a version. */
const VERSION_LENGTH = 32;
const SDK_KIND_NAMES: readonly string[] = SDK_API_KEY_KINDS;

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/** Groups rows that all point at one parent, keeping the order they arrived in. */
function indexBy<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const bucket = grouped.get(key);

    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  return grouped;
}

/**
 * A runtime key reads one environment's configuration and nothing else.
 *
 * The route mounts only the key middleware, so this is the other half of the
 * same rule: a management key that arrived here, a key without the read scope,
 * and a project-wide key all stop at this line.
 */
function assertRuntimeKey(
  access: ApiKeyAccessContext,
): asserts access is ApiKeyAccessContext & {
  environmentId: string;
  environmentKey: string;
} {
  if (!SDK_KIND_NAMES.includes(access.kind)) {
    throw ApiError.forbidden(
      "A management key cannot be used as an SDK key. Issue one for the environment instead.",
    );
  }

  if (!access.scopes.includes("flags:read")) {
    throw ApiError.forbidden("This key may not read flag configuration.");
  }

  if (!access.environmentId || !access.environmentKey) {
    throw ApiError.forbidden("An SDK key is issued for one environment.");
  }
}

/**
 * The configuration one environment's SDK evaluates from.
 *
 * Everything is fetched for the environment the key was issued into, and nothing
 * from the request is trusted, so a key cannot read another project, another
 * environment or another tenant.
 */
export class SdkService {
  constructor(private readonly repository: SdkRepository) {}

  async load(access: ApiKeyAccessContext): Promise<SdkConfig> {
    assertRuntimeKey(access);

    const meta = await this.repository.findMeta(
      access.projectId,
      access.environmentId,
    );

    if (!meta) {
      throw ApiError.notFound("Environment not found.");
    }

    const sources = await this.repository.listFlagSources(
      access.projectId,
      access.environmentId,
    );
    const flagIds = sources.map((source) => source.id);

    const [variations, rules, targets, segments] = await Promise.all([
      this.repository.listVariations(flagIds),
      this.repository.listRules(flagIds, access.environmentId),
      this.repository.listTargets(flagIds, access.environmentId),
      this.repository.listSegments(access.projectId),
    ]);

    const [ruleConditions, segmentConditions] = await Promise.all([
      this.repository.listRuleConditions(rules.map((rule) => rule.id)),
      this.repository.listSegmentConditions(
        segments.map((segment) => segment.id),
      ),
    ]);

    const conditionsByRule = indexBy(ruleConditions, (row) => row.parentId);
    const conditionsBySegment = indexBy(
      segmentConditions,
      (row) => row.parentId,
    );
    const variationsByFlag = indexBy(variations, (row) => row.flagId);
    const rulesByFlag = indexBy(rules, (row) => row.flagId);
    const targetsByFlag = indexBy(targets, (row) => row.flagId);

    const flags = sources.map((source) =>
      toFlag(
        source,
        variationsByFlag.get(source.id) ?? [],
        (rulesByFlag.get(source.id) ?? []).map((rule) =>
          toRule(rule, conditionsByRule.get(rule.id) ?? []),
        ),
        (targetsByFlag.get(source.id) ?? []).map(toTarget),
      ),
    );

    const segmentBodies = segments.map((segment) =>
      toSegment(segment, conditionsBySegment.get(segment.id) ?? []),
    );

    return toConfig(
      meta,
      this.versionOf(meta, flags, segmentBodies),
      flags,
      segmentBodies,
    );
  }

  /**
   * A digest of everything a client would serve differently.
   *
   * It is the response's ETag, so it has to change when the decisions could and
   * stay the same when they could not: the payload is hashed in exactly the
   * order the mapper builds it.
   */
  private versionOf(
    meta: SdkMeta,
    flags: SdkFlag[],
    segments: SdkSegment[],
  ): string {
    const payload = JSON.stringify({
      project: { key: meta.projectKey, name: meta.projectName },
      environment: { key: meta.environmentKey, name: meta.environmentName },
      flags,
      segments,
    });

    return hex(sha256(utf8Bytes(payload))).slice(0, VERSION_LENGTH);
  }
}
