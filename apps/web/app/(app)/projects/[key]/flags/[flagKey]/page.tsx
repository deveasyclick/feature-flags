import type { Metadata } from "next";
import type { FlagVariationValue } from "@dariise/contracts";
import { ArchiveFlagAction } from "@/components/app/flags/archive-flag-dialog";
import { FlagApprovalPanel } from "@/components/app/flags/flag-approval";
import { FlagConfiguration } from "@/components/app/flags/flag-configuration";
import {
  DangerZoneCard,
  FlagFallback,
  FlagMetadata,
} from "@/components/app/flags/flag-config-panels";
import { FlagDependencies } from "@/components/app/flags/flag-dependencies";
import { FlagDetailHeader } from "@/components/app/flags/flag-headers";
import { FlagHistory } from "@/components/app/flags/flag-history";
import {
  listFlagVersions,
  loadFlagConfig,
  loadFlagDetail,
  loadPendingChangeRequest,
  requireFlagPageScope,
} from "@/components/app/flags/flag-queries";
import {
  FlagTabs,
  toFlagTab,
  type FlagTab,
} from "@/components/app/flags/flag-tabs";
import { FlagTargeting } from "@/components/app/flags/flag-targeting";
import { FlagVariations } from "@/components/app/flags/flag-variations";
import { flags as flagsApi } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type FlagPageProps = PageProps<"/projects/[key]/flags/[flagKey]">;

/** `?environment=` and `?tab=` are single-valued; anything else is ignored. */
function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata(
  props: FlagPageProps,
): Promise<Metadata> {
  const { key, flagKey } = await props.params;
  const flag = await loadFlagDetail(key, flagKey);

  return {
    title: `${flag.key} · Feature Flags`,
    description: flag.description ?? undefined,
  };
}

/**
 * The canonical flag page.
 *
 * A flag is one project-scoped entity, so its identity lives here and the
 * environment is chosen with `?environment=` — the configuration, targeting
 * rules, history and per-environment state all follow that choice. The tab is
 * carried in `?tab=` so every section stays a linkable URL.
 */
export default async function FlagDetailPage(props: FlagPageProps) {
  const { key, flagKey } = await props.params;
  const searchParams = await props.searchParams;
  const now = new Date();

  const tab: FlagTab = toFlagTab(searchParams.tab);
  const { projectKey, environmentKey, environmentName, protectedEnvironment } =
    await requireFlagPageScope(key, firstParam(searchParams.environment));

  const [flag, config] = await Promise.all([
    loadFlagDetail(projectKey, flagKey),
    loadFlagConfig(projectKey, flagKey, environmentKey),
  ]);

  const defaultVariation = flag.variations.find(
    (variation) => variation.key === config.defaultVariation,
  );
  const defaultValue: FlagVariationValue =
    defaultVariation?.value ?? config.defaultVariation;

  // The off variation is what a flag serves when it is off, archived or passed
  // over by a rollout, so it is the value the SDK fallback is seeded from.
  const offVariation = flag.variations.find(
    (variation) => variation.key === config.offVariation,
  );
  const offValue: FlagVariationValue =
    offVariation?.value ?? config.offVariation;

  // Re-key the interactive tabs on the flag and environment so switching
  // either never leaves the previous screen's local state in place.
  const pageKey = `${flag.key}:${environmentKey}`;

  const header = (
    <FlagDetailHeader
      flag={flag}
      projectKey={projectKey}
      environmentKey={environmentKey}
      environmentLabel={environmentName}
      enabled={config.enabled}
    />
  );

  const tabs = (
    <FlagTabs
      projectKey={projectKey}
      flagKey={flag.key}
      environmentKey={environmentKey}
      active={tab}
    />
  );

  if (tab === "variations") {
    return (
      <>
        {header}
        {tabs}
        <FlagVariations
          key={pageKey}
          projectKey={projectKey}
          flagKey={flag.key}
          type={flag.type}
          variations={flag.variations}
          protectedEnvironment={protectedEnvironment}
        />
      </>
    );
  }

  if (tab === "targeting") {
    const [rules, targets, pendingApproval] = await Promise.all([
      flagsApi.rules(projectKey, flag.key, environmentKey),
      flagsApi.targets(projectKey, flag.key, environmentKey),
      loadPendingChangeRequest(projectKey, flag.key, environmentKey),
    ]);

    return (
      <>
        {header}
        {tabs}
        <FlagTargeting
          key={pageKey}
          projectKey={projectKey}
          flagKey={flag.key}
          flag={flag}
          config={config}
          rules={rules}
          targets={targets}
          updatedLabel={formatRelativeTime(flag.updatedAt, now)}
          protectedEnvironment={protectedEnvironment}
          approval={
            <FlagApprovalPanel
              projectKey={projectKey}
              flagKey={flag.key}
              request={pendingApproval}
              protectedEnvironment={protectedEnvironment}
            />
          }
        />
      </>
    );
  }

  if (tab === "history") {
    const versions = await listFlagVersions(
      projectKey,
      flag.key,
      environmentKey,
    );

    return (
      <>
        {header}
        {tabs}
        <FlagHistory
          flagKey={flag.key}
          versions={versions}
          environmentName={environmentName}
          variationCount={flag.variations.length}
          rolloutPercentage={config.rolloutPercentage}
          now={now}
        />
      </>
    );
  }

  if (tab === "dependencies") {
    const graph = await flagsApi.dependencies(projectKey, flag.key);

    return (
      <>
        {header}
        {tabs}
        <FlagDependencies
          graph={graph}
          flagKey={flag.key}
          status={flag.status}
        />
      </>
    );
  }

  const pendingApproval = await loadPendingChangeRequest(
    projectKey,
    flag.key,
    environmentKey,
  );

  return (
    <>
      {header}
      {tabs}
      <FlagConfiguration
        key={pageKey}
        projectKey={projectKey}
        flagKey={flag.key}
        flag={flag}
        config={config}
        updatedLabel={formatRelativeTime(flag.updatedAt, now)}
        metadata={
          <>
            <FlagMetadata flag={flag} now={now} />
            <FlagFallback
              flagKey={flag.key}
              type={flag.type}
              defaultValue={defaultValue}
              fallback={offValue}
            />
          </>
        }
        dangerZone={
          <DangerZoneCard>
            <ArchiveFlagAction projectKey={projectKey} flag={flag} />
          </DangerZoneCard>
        }
        protectedEnvironment={protectedEnvironment}
        approval={
          <FlagApprovalPanel
            projectKey={projectKey}
            flagKey={flag.key}
            request={pendingApproval}
            protectedEnvironment={protectedEnvironment}
          />
        }
      />
    </>
  );
}
