import type {
  ApiKey,
  ApiKeyKind,
  EnvironmentSummary,
} from "@iwifunni/contracts";
import {
  resolveEnvironmentColor,
  type EnvironmentColor,
} from "@/lib/environment-color";
import { formatDate, formatRelativeTime } from "@/lib/format";

export interface EnvironmentOption {
  key: string;
  name: string;
  color: EnvironmentColor;
}

export interface ApiKeyView {
  id: string;
  name: string;
  /** `management` is the dashboard's credential; the others are runtime SDK keys. */
  kind: ApiKeyKind;
  /** Non-secret identifier the API returns; the secret is never in a list row. */
  prefix: string;
  /** The secret's tail, kept so the list can mask the key it names. */
  suffix: string;
  /** `prefix*****suffix`, which is what the Key column renders. */
  maskedKey: string;
  /** `null` when the key is valid in every environment. */
  environmentKey: string | null;
  environmentName: string;
  environmentColor: EnvironmentColor | null;
  createdLabel: string;
  lastUsedLabel: string;
}

export function toEnvironmentOptions(
  environments: EnvironmentSummary[],
): EnvironmentOption[] {
  return environments.map((environment) => ({
    key: environment.key,
    name: environment.name,
    color: resolveEnvironmentColor(environment.color),
  }));
}

/**
 * The key as the list shows it: the non-secret head, a run of asterisks, and the
 * secret's tail.
 *
 * Only the two ends are ever stored, so it is what the mask can honestly show. A
 * key created before the tail was kept falls back to its head alone, because the
 * tail it never stored cannot be recovered.
 */
export function maskKey(prefix: string, suffix: string): string {
  return suffix ? `${prefix.slice(0, 5)}*****${suffix}` : prefix;
}

export function toApiKeyView(
  key: ApiKey,
  environments: EnvironmentOption[],
  now: Date,
): ApiKeyView {
  const environment =
    key.environmentKey === null
      ? null
      : (environments.find((item) => item.key === key.environmentKey) ?? null);

  return {
    id: key.id,
    name: key.name,
    kind: key.kind,
    prefix: key.prefix,
    suffix: key.suffix,
    maskedKey: maskKey(key.prefix, key.suffix),
    environmentKey: key.environmentKey,
    environmentName:
      key.environmentKey === null
        ? "All environments"
        : (environment?.name ?? key.environmentKey),
    environmentColor: environment?.color ?? null,
    createdLabel: formatDate(key.createdAt),
    lastUsedLabel: key.lastUsedAt
      ? formatRelativeTime(key.lastUsedAt, now)
      : "Never",
  };
}
