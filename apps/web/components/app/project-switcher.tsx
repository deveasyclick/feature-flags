"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { CheckIcon, ChevronDownIcon, FolderIcon, PlusIcon } from "lucide-react";
import { cn } from "cn";
import { environmentColorTone } from "@/components/app/environments/environment-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@iwifunni/contracts";
import { resolveEnvironmentColor } from "@/lib/environment-color";
import { selectProject } from "@/lib/scope-actions";

interface ProjectSwitcherProps {
  readonly project: Project;
  /** Every project in the workspace, in the order the menu lists them. */
  readonly projects: Project[];
}

/**
 * Project switcher in the sidebar header.
 *
 * Selecting a project writes the scope cookie through a Server Action and
 * re-renders the current screen against it; the project's own colour tints the
 * icon tile, so the menu stays legible without a per-project glyph.
 *
 * A screen that names its project in the URL — `/projects/:key`, a segment —
 * belongs to the project that was selected when it was opened, so the selection
 * has to move the route as well. Every other screen reads the cookie and only
 * needs a re-render.
 */
export function ProjectSwitcher({ project, projects }: ProjectSwitcherProps) {
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();

  function select(key: string) {
    startTransition(async () => {
      await selectProject(key);

      // The same screen of the project just chosen, where that is addressable.
      if (pathname.startsWith(`/projects/${project.key}`)) {
        router.replace(
          pathname.replace(`/projects/${project.key}`, `/projects/${key}`),
        );
        return;
      }

      // An environment screen names its environment in the URL, and that key
      // belongs to the project it was chosen in; the new project's list of
      // environments is the nearest screen that holds for it.
      const environmentScoped =
        pathname.startsWith("/environments/") &&
        !pathname.startsWith("/environments/new");

      if (environmentScoped) {
        router.replace("/environments");
        return;
      }

      // A segment key belongs to the project it was created in, so it cannot be
      // carried across; the list of the new project is the nearest screen.
      if (/^\/segments\/[^/]+/.test(pathname)) {
        router.replace("/segments");
        return;
      }

      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="bg-nav-chip border-nav-chip-line hover:border-nav-active/60 flex w-full items-center gap-2.5 rounded-lg border p-1.5 text-left transition-colors disabled:opacity-70"
        >
          <span className="bg-nav-active flex size-6 shrink-0 items-center justify-center rounded-md text-white">
            <FolderIcon aria-hidden="true" className="size-3.5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="text-nav-dim block text-[10px]">Project</span>
            <span className="block truncate text-[12px] font-medium text-white">
              {project.name}
            </span>
          </span>
          <ChevronDownIcon
            aria-hidden="true"
            className="text-nav-dim size-3.5 shrink-0"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64 p-1.5">
        <DropdownMenuLabel className="text-muted-foreground px-1.5 text-[10px] font-medium tracking-[0.14em] uppercase">
          Projects
        </DropdownMenuLabel>

        {projects.map((item) => {
          const current = item.key === project.key;

          return (
            <DropdownMenuItem
              key={item.key}
              disabled={pending}
              onSelect={() => {
                if (current) return;
                select(item.key);
              }}
              className={cn("gap-2.5 px-1.5 py-1.5", current && "bg-primary/5")}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  current
                    ? environmentColorTone[resolveEnvironmentColor(item.color)]
                    : "bg-muted text-muted-foreground",
                )}
              >
                <FolderIcon aria-hidden="true" className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {item.name}
                </span>
                <span className="text-muted-foreground block truncate text-[11px]">
                  {item.environmentCount}{" "}
                  {item.environmentCount === 1 ? "environment" : "environments"}
                </span>
              </span>
              {current ? (
                <CheckIcon
                  aria-hidden="true"
                  className="text-primary size-3.5 shrink-0"
                />
              ) : null}
            </DropdownMenuItem>
          );
        })}

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/projects/new">
            <PlusIcon aria-hidden="true" />
            Create project
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/projects">
            <FolderIcon aria-hidden="true" />
            Manage projects
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
