import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app/app-sidebar";
import { Topbar } from "@/components/app/topbar";
import { getScope, toChromeUser } from "@/lib/scope";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }

  if (!session.workspace) {
    redirect("/create-workspace");
  }

  if (!session.hasProject) {
    redirect("/create-project");
  }

  const scope = await getScope();

  if (!scope.project) {
    redirect("/create-project");
  }

  const user = toChromeUser(session);

  return (
    <div className="flex h-svh overflow-hidden">
      <AppSidebar
        user={user}
        project={scope.project}
        projects={scope.projects}
        environments={scope.environments}
        environment={scope.environment}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} />
        <main className="bg-background flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
