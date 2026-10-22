import type { Metadata } from "next";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { notFound } from "next/navigation";
import { ApiKeyTable } from "@/components/app/api-keys/api-key-table";
import { CreateApiKeyDialog } from "@/components/app/api-keys/create-api-key-dialog";
import {
  toApiKeyView,
  toEnvironmentOptions,
} from "@/components/app/api-keys/api-key-view";
import { PageHeader } from "@/components/app/page-header";
import { apiKeys } from "@/lib/api";
import { getScope } from "@/lib/scope";

export const metadata: Metadata = {
  title: "API Keys",
  description: "Authenticate SDK clients and CI jobs against each environment.",
};

export const dynamic = "force-dynamic";

export default async function ApiKeysPage({ searchParams }: { readonly searchParams: Promise<{ search?: string; cursor?: string }> }) {
  const params = await searchParams;
  const search = params.search?.slice(0, 200);
  const { project, environments, environment } = await getScope();

  if (!project || !environment) notFound();

  const now = new Date();
  // Keys of the environment the dashboard is scoped to, plus the project-wide
  // ones that authenticate in it: a key is issued into one environment, and the
  // chrome already names which.
  const page = await apiKeys.list(project.key, {
    search,
    cursor: params.cursor,
    environmentKey: environment.key,
  });
  const environmentOptions = toEnvironmentOptions(environments);
  const keys = page.data.map((key) =>
    toApiKeyView(key, environmentOptions, now),
  );

  return (
    <>
      <PageHeader
        title="API Keys"
        description={`Authenticate SDK clients and CI jobs against ${environment.name}.`}
      >
        <CreateApiKeyDialog
          projectKey={project.key}
          environmentKey={environment.key}
          environmentName={environment.name}
        />
      </PageHeader>

      <form action="/api-keys" className="mb-4 flex gap-2">
        <Input name="search" type="search" aria-label="Search API keys" defaultValue={search} maxLength={200} placeholder="Search names or prefixes" />
        <Button variant="outline" type="submit">Search keys</Button>
        {search && <Link href="/api-keys" className="self-center text-sm">Clear</Link>}
      </form>
      <ApiKeyTable
        projectKey={project.key}
        keys={keys}
        truncated={page.nextCursor !== null}
      />
      <nav aria-label="API key pages" className="mt-4 flex gap-4 text-sm">
        {params.cursor && <Link href={`/api-keys?search=${encodeURIComponent(search ?? "")}`}>First page</Link>}
        {page.nextCursor && <Link href={`/api-keys?cursor=${encodeURIComponent(page.nextCursor)}&search=${encodeURIComponent(search ?? "")}`}>Next page</Link>}
      </nav>
    </>
  );
}
