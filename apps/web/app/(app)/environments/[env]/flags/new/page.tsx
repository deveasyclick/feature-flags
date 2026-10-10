import type { Metadata } from "next";
import { CreateFlagForm } from "@/components/app/flags/create-flag-form";
import { requireFlagScope } from "@/components/app/flags/flag-queries";

export const metadata: Metadata = {
  title: "Create Feature Flag",
  description: "Name a flag, choose what it returns, and create it.",
};

export const dynamic = "force-dynamic";

export default async function CreateFlagPage(
  props: PageProps<"/environments/[env]/flags/new">,
) {
  const { env } = await props.params;
  const { projectKey, environmentKey, environmentName } =
    await requireFlagScope(env);

  return (
    <div className="mx-auto max-w-5xl">
      <CreateFlagForm
        projectKey={projectKey}
        environmentKey={environmentKey}
        environmentName={environmentName}
      />
    </div>
  );
}
