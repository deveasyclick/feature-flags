"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon, PanelLeftIcon, SettingsIcon } from "lucide-react";
import { cn } from "cn";
import { Logo } from "@/components/logo";
import { EnvironmentSwitcher } from "@/components/app/environment-switcher";
import { navSections } from "@/components/app/nav-config";
import { ProjectSwitcher } from "@/components/app/project-switcher";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentSummary, Project } from "@iwifunni/contracts";
import type { ChromeUser } from "@/lib/scope";

interface SidebarProps {
  readonly user: ChromeUser;
  /** The project the dashboard is scoped to. */
  readonly project: Project;
  /** Every project in the workspace, for the switcher menu. */
  readonly projects: Project[];
  /** Every environment in the current project. */
  readonly environments: EnvironmentSummary[];
  /** The environment the dashboard is scoped to. */
  readonly environment: EnvironmentSummary | null;
}

/** The shared nav list. Rendered by both the sidebar and the mobile drawer. */
function NavList() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-4">
      {navSections.map((section) => (
        <div key={section.label}>
          <p className="text-nav-dim/70 px-2.5 pb-1.5 text-[10px] font-medium tracking-[0.14em] uppercase">
            {section.label}
          </p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const Icon = item.icon;

              if (!item.href) {
                return (
                  <li key={item.label}>
                    <span
                      aria-disabled="true"
                      title={`${item.label} — coming soon`}
                      className="text-nav-dim/55 flex cursor-not-allowed items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px]"
                    >
                      <Icon aria-hidden="true" className="size-4 shrink-0" />
                      <span className="truncate">{item.label}</span>
                      <span className="sr-only">Coming soon</span>
                    </span>
                  </li>
                );
              }

              const active =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
                      active
                        ? "bg-nav-active text-white"
                        : "text-nav-dim hover:bg-nav-chip hover:text-white",
                    )}
                  >
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function UserChip({ user }: { readonly user: ChromeUser }) {
  return (
    <div className="border-nav-line flex items-center gap-2.5 border-t pt-3">
      <span className="bg-nav-active flex size-8 shrink-0 items-center justify-center rounded-full text-[11px] font-medium text-white">
        {user.initials}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium text-white">
          {user.name}
        </span>
        <span className="text-nav-dim block truncate text-[10px]">
          {user.email}
        </span>
      </span>
      <Link
        href="/settings"
        aria-label="Workspace settings"
        className="text-nav-dim hover:bg-nav-chip hover:text-white flex size-7 shrink-0 items-center justify-center rounded-md transition-colors"
      >
        <SettingsIcon aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  );
}

/** Fixed desktop sidebar. Hidden below `lg`; `MobileNav` covers small screens. */
export function AppSidebar({
  user,
  project,
  projects,
  environments,
  environment,
}: SidebarProps) {
  return (
    <aside className="bg-nav-bg hidden w-56 shrink-0 flex-col justify-between p-3 lg:flex">
      <div>
        <div className="flex items-center gap-2 px-1.5 py-2">
          <span className="bg-nav-active flex size-7 shrink-0 items-center justify-center rounded-lg text-white">
            <Logo className="size-4" />
          </span>
          <span className="text-[13px] font-semibold tracking-[0.2em] text-white uppercase">
            Iwifunni
          </span>
          <span
            title="Collapse sidebar — coming soon"
            aria-hidden="true"
            className="bg-nav-chip text-nav-dim ml-auto flex size-7 shrink-0 items-center justify-center rounded-md"
          >
            <PanelLeftIcon className="size-3.5" />
          </span>
        </div>

        <div className="mt-2">
          <ProjectSwitcher project={project} projects={projects} />

          <div className="mt-1">
            <EnvironmentSwitcher
              environments={environments}
              environment={environment}
            />
          </div>
        </div>

        <div className="mt-5">
          <NavList />
        </div>
      </div>

      <UserChip user={user} />
    </aside>
  );
}

/** Hamburger + drawer shown only below `lg`. */
export function MobileNav() {
  return (
    <div className="lg:hidden">
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Open navigation"
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex size-8 items-center justify-center rounded-md transition-colors"
        >
          <MenuIcon aria-hidden="true" className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 p-3">
          {navSections.map((section) => (
            <div key={section.label} className="mt-1">
              <p className="text-muted-foreground px-2 pb-1 text-[10px] font-medium tracking-[0.14em] uppercase">
                {section.label}
              </p>
              {section.items.map((item) => {
                const Icon = item.icon;
                return item.href ? (
                  <DropdownMenuItem key={item.label} asChild>
                    <Link href={item.href}>
                      <Icon aria-hidden="true" className="size-4" />
                      {item.label}
                    </Link>
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem
                    key={item.label}
                    disabled
                    title={`${item.label} — coming soon`}
                    className="text-muted-foreground"
                  >
                    <Icon aria-hidden="true" className="size-4" />
                    {item.label}
                    <span className="sr-only">Coming soon</span>
                  </DropdownMenuItem>
                );
              })}
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
