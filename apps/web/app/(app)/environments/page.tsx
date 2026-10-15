import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import type { EnvironmentSummary } from "@iwifunni/contracts";
import {
  EnvironmentGrid,
  type EnvironmentCardData,
} from "@/components/app/environments/environment-cards";
import { environmentFlagCounts } from "@/components/app/environments/capped-count";
import { listProjectFlags } from "@/components/app/flags/flag-queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { getScope, listEnvironments } from "@/lib/scope";

export const metadata: Metadata = {
  title: "Environments",
  description:
    "Isolated flag configurations with separate API keys, endpoints, and audit trails.",
};

export const dynamic = "force-dynamic";

export default async function EnvironmentsPage() {
  const { project } = await getScope();

  if (!project) return null;

  const projectKey = project.key;

  const [environments, all, flags] = await Promise.all([
    listEnvironments(projectKey),
    listEnvironments(projectKey, { includeArchived: true }),
    listProjectFlags(projectKey),
  ]);

  const archived = all.filter(
    (environment) => environment.archivedAt !== null,
  );

  async function toCards(
    list: EnvironmentSummary[],
  ): Promise<EnvironmentCardData[]> {
    return Promise.all(
      list.map(async (environment) => {
        const { connection } = await api.environments.get(
          projectKey,
          environment.key,
        );

        return {
          environment,
          connection,
          // One project list feeds every card, and each flag carries its own
          // per-environment summaries.
          counts: environmentFlagCounts(flags, environment.key, false),
        };
      }),
    );
  }

  const cards = await toCards(environments);
  const archivedCards = await toCards(archived);

  return (
    <>
      <PageHeader
        title="Environments"
        description="Isolated flag configurations with separate API keys, endpoints, and audit trails."
      >
        <Button asChild size="sm" className="gap-1.5 text-[11px]">
          <Link href="/environments/new">
            <PlusIcon aria-hidden="true" className="size-3.5" />
            New Environment
          </Link>
        </Button>
      </PageHeader>

      <EnvironmentGrid environments={cards} />

      {archivedCards.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-muted-foreground mb-2 text-[11px] font-medium tracking-[0.14em] uppercase">
            Archived
          </h2>
          <p className="text-muted-foreground mb-3 text-[12px]">
            Archived environments keep their flag configuration but stay out of
            the switcher. Their SDK keys were revoked.
          </p>
          <EnvironmentGrid environments={archivedCards} />
        </section>
      ) : null}
    </>
  );
}
