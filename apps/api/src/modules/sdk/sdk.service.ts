import {
  SDK_API_KEY_KINDS,
  type SdkConfig,
  type SdkFlag,
  type SdkSegment,
  type ClientEvaluateRequest,
  type ClientEvaluateResponse,
} from "@iwifunni/contracts";
import {
  sha256,
  utf8Bytes,
  evaluateSnapshot,
  servedValue,
} from "@iwifunni/engine";

import type { Transaction } from "../../shared/types/db.js";
import { ApiError } from "../../shared/http/errors.js";
import type { ApiKeyAccessContext, ApiKeyResolver } from "../api-keys/index.js";
import { toConfig, toFlag, toRule, toSegment, toTarget } from "./sdk.mapper.js";
import type { SdkRepository } from "./sdk.repository.js";
import {
  type SdkMeta,
  SDK_STREAM_MAX_CONNECTIONS,
  SDK_STREAM_MAX_PER_KEY,
} from "./sdk.types.js";

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
  if (!SDK_KIND_NAMES.includes(access.kind) || access.kind !== "server") {
    throw ApiError.forbidden(
      "Configuration snapshots require a server SDK key. Browser and management keys cannot download targeting data.",
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
  private readonly streams = new Map<string, number>();
  private activeStreams = 0;
  constructor(
    private readonly repository: SdkRepository,
    private readonly authenticate: ApiKeyResolver,
  ) {}

  openStream(access: ApiKeyAccessContext): () => void {
    assertRuntimeKey(access);
    const count = this.streams.get(access.apiKeyId) ?? 0;
    if (
      this.activeStreams >= SDK_STREAM_MAX_CONNECTIONS ||
      count >= SDK_STREAM_MAX_PER_KEY
    )
      throw ApiError.rateLimited();
    this.activeStreams++;
    this.streams.set(access.apiKeyId, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeStreams--;
      const remaining = (this.streams.get(access.apiKeyId) ?? 1) - 1;
      if (remaining > 0) this.streams.set(access.apiKeyId, remaining);
      else this.streams.delete(access.apiKeyId);
    };
  }

  async streamVersion(secret: string): Promise<string> {
    const access = await this.authenticate(secret);
    if (!access) throw ApiError.unauthorized();
    return (await this.load(access)).version;
  }

  async load(access: ApiKeyAccessContext): Promise<SdkConfig> {
    assertRuntimeKey(access);
    return this.repository.withSnapshot((tx) => this.loadSnapshot(access, tx));
  }

  async evaluateClient(
    access: ApiKeyAccessContext,
    input: ClientEvaluateRequest,
  ): Promise<ClientEvaluateResponse> {
    if (
      access.kind !== "client" ||
      !access.scopes.includes("flags:read") ||
      !access.environmentId ||
      !access.environmentKey
    )
      throw ApiError.forbidden("An environment-scoped client key is required.");
    const scopedAccess = {
      ...access,
      environmentId: access.environmentId,
      environmentKey: access.environmentKey,
    };
    const snapshot = await this.repository.withSnapshot((tx) =>
      this.loadSnapshot(scopedAccess, tx, true),
    );
    const requested = snapshot.flags.filter((flag) =>
      input.flags.includes(flag.key),
    );
    const segmentKeys = new Set(
      requested.flatMap((flag) =>
        flag.rules.flatMap((rule) => rule.segmentKeys),
      ),
    );
    const conditions = [
      ...requested.flatMap((flag) =>
        flag.rules.flatMap((rule) => rule.conditions),
      ),
      ...snapshot.segments
        .filter((segment) => segmentKeys.has(segment.key))
        .flatMap((segment) => segment.conditions),
    ];
    if (conditions.some((condition) => condition.operator === "matches_regex"))
      throw ApiError.badRequest(
        "Browser delivery does not support regex targeting conditions. Use a server SDK for these flags.",
      );
    const entries = input.flags.flatMap((key) => {
      if (!snapshot.flags.some((flag) => flag.key === key)) return [];
      const outcome = evaluateSnapshot(snapshot, key, input.user);
      return [
        [
          key,
          {
            value: servedValue(snapshot, key, outcome.variation) ?? null,
            enabled: outcome.enabled,
          },
        ],
      ];
    });
    return { flags: Object.fromEntries(entries) };
  }

  private async loadSnapshot(
    access: ApiKeyAccessContext & {
      environmentId: string;
      environmentKey: string;
    },
    tx: Transaction,
    clientOnly = false,
  ): Promise<SdkConfig> {
    const meta = await this.repository.findMeta(
      access.projectId,
      access.environmentId,
      tx,
    );

    if (!meta) {
      throw ApiError.notFound("Environment not found.");
    }

    const sources = await this.repository.listFlagSources(
      access.projectId,
      access.environmentId,
      tx,
      clientOnly,
    );
    const flagIds = sources.map((source) => source.id);

    const [variations, rules, targets, segments] = await Promise.all([
      this.repository.listVariations(flagIds, tx),
      this.repository.listRules(flagIds, access.environmentId, tx),
      this.repository.listTargets(flagIds, access.environmentId, tx),
      this.repository.listSegments(access.projectId, tx),
    ]);

    const [ruleConditions, segmentConditions] = await Promise.all([
      this.repository.listRuleConditions(
        rules.map((rule) => rule.id),
        tx,
      ),
      this.repository.listSegmentConditions(
        segments.map((segment) => segment.id),
        tx,
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
