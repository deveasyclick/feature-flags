import { GlobalSearch } from "./global-search";
import { NotificationsMenu } from "./notifications-menu";
import { AccountMenu } from "@/components/app/account-menu";
import { MobileNav } from "@/components/app/app-sidebar";
import type { ChromeUser } from "@/lib/scope";
import { WorkspaceSwitcher } from "./workspace-switcher";

interface TopbarProps {
  readonly projectKey: string;
  readonly environmentKey?: string;
  readonly user: ChromeUser;
  readonly workspaceId?: string;
}

export function Topbar({ user, workspaceId, projectKey, environmentKey }: TopbarProps) {
  return (
    <header className="bg-card flex h-12 shrink-0 items-center gap-3 border-b px-3">
      <MobileNav />

      <GlobalSearch key={`${projectKey}:${environmentKey}`} projectKey={projectKey} environmentKey={environmentKey} />

      <div className="ml-auto flex items-center gap-2">
        {workspaceId && <WorkspaceSwitcher workspaceId={workspaceId} />}
        <NotificationsMenu key={workspaceId} />

        <span
          aria-hidden="true"
          className="bg-border hidden h-5 w-px sm:block"
        />

        <AccountMenu user={user} />
      </div>
    </header>
  );
}
