import type { Metadata } from "next";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { FlagsTable } from "@/components/app/flags-table";
import {
  listEnvironmentFlags,
  requireFlagScope,
} from "@/components/app/flags/flag-queries";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/environments/[env]/flags">,
): Promise<Metadata> {
  const { env } = await props.params;
  const { environmentName } = await requireFlagScope(env);

  return {
    title: `Feature Flags · ${environmentName}`,
    description: `Manage feature flags in ${environmentName}.`,
  };
}

export default async function EnvironmentFlagsPage(
  props: PageProps<"/environments/[env]/flags">,
) {
  const { env } = await props.params;
  const now = new Date();

  const {
    projectKey,
    environmentKey,
    environmentName,
    protectedEnvironment,
  } = await requireFlagScope(env);
  const flags = await listEnvironmentFlags(projectKey, environmentKey);

  return (
    <>
      <PageHeader
        title="Feature Flags"
        description={`Manage feature flags in ${environmentName}.`}
      >
        <Button asChild size="sm" className="gap-1.5 text-[11px]">
          <Link href={`/environments/${environmentKey}/flags/new`}>
            <PlusIcon aria-hidden="true" className="size-3.5" />
            New Flag
          </Link>
        </Button>
      </PageHeader>

      <FlagsTable
        projectKey={projectKey}
        flags={flags}
        environmentKey={environmentKey}
        environmentName={environmentName}
        now={now.toISOString()}
        protectedEnvironment={protectedEnvironment}
      />
    </>
  );
}
