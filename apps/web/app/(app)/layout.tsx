import { redirect } from "next/navigation";

import { AppSidebar } from "@/components/app/app-sidebar";
import { Topbar } from "@/components/app/topbar";
import { getScope, toChromeUser } from "@/lib/scope";
import { getSession } from "@/lib/session";
import { ArchivedProjects } from "@/components/app/projects/archived-projects";
import { CreateProjectForm } from "@/components/app/projects/create-project-form";
import { WorkspaceSwitcher } from "@/components/app/workspace-switcher";
import { PersonalTheme } from "@/components/app/personal-theme";
import { me } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const session = await getSession();

  if (!session) {
    redirect("/sign-in");
  }
  if (session.mfaRequired) redirect("/two-factor");
  if (session.mfaEnrollmentRequired) redirect("/setup-two-factor");

  if (!session.workspace) {
    redirect("/create-workspace");
  }

  if (!session.hasProject) {
    redirect("/create-project");
  }

  const scope = await getScope();

  if (!scope.project) {
    return <main className="max-w-3xl mx-auto p-6 space-y-6"><WorkspaceSwitcher workspaceId={session.workspace.id} /><h1 className="text-xl font-medium">No active project</h1><p className="text-sm text-muted-foreground">Restore an archived project or create a new one to continue.</p><ArchivedProjects /><CreateProjectForm /></main>;
  }

  const user = toChromeUser(session);
  const preferences = await me.getPreferences();

  return (
    <PersonalTheme initialTheme={preferences.theme}><div className="flex h-svh overflow-hidden">
      <AppSidebar
        user={user}
        project={scope.project}
        projects={scope.projects}
        environments={scope.environments}
        environment={scope.environment}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar user={user} workspaceId={session.workspace.id} projectKey={scope.project.key} environmentKey={scope.environment?.key} />
        <main className="bg-background flex-1 overflow-y-auto p-4 sm:p-6">
          {children}
        </main>
      </div>
    </div></PersonalTheme>
  );
}
