"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronsUpDownIcon,
  PlusIcon,
  ServerIcon,
} from "lucide-react";
import { cn } from "cn";
import { environmentColorSwatch } from "@/components/app/environments/environment-colors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentSummary } from "@iwifunni/contracts";
import { resolveEnvironmentColor } from "@/lib/environment-color";
import { selectEnvironment } from "@/lib/scope-actions";

interface EnvironmentSwitcherProps {
  /** Every environment in the current project. */
  readonly environments: EnvironmentSummary[];
  /** The environment the dashboard is scoped to, when one resolved. */
  readonly environment: EnvironmentSummary | null;
}

/**
 * Environment switcher below the project switcher.
 *
 * Selecting an environment writes the scope cookie through a Server Action, so
 * every screen that reads flags reads them in the environment the chrome shows.
 *
 * An environment-scoped screen names its environment in the URL rather than
 * reading the cookie (`requireFlagScope`), so the selection has to travel with
 * the URL or the page would keep rendering the environment it was opened with.
 * The rest of the dashboard reads the cookie and only needs a re-render.
 */
export function EnvironmentSwitcher({
  environments,
  environment,
}: EnvironmentSwitcherProps) {
  const [pending, startTransition] = useTransition();
  const pathname = usePathname();
  const router = useRouter();
  const current = environment ?? environments[0] ?? null;

  /** Keep the reader on the same screen, addressed by the environment chosen. */
  function select(key: string) {
    startTransition(async () => {
      await selectEnvironment(key);

      const target = pathname.replace(
        /^\/environments\/[^/]+/,
        `/environments/${key}`,
      );

      if (target === pathname) router.refresh();
      else router.replace(target);
    });
  }

  if (!current) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending}
          className="hover:bg-nav-chip flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors disabled:opacity-70"
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-2 shrink-0 rounded-full",
              environmentColorSwatch[resolveEnvironmentColor(current.color)],
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="text-nav-dim block text-[10px]">Environment</span>
            <span className="block truncate text-[12px] font-medium text-white/90">
              {current.name}
            </span>
          </span>
          <ChevronsUpDownIcon
            aria-hidden="true"
            className="text-nav-dim size-3.5 shrink-0"
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64 p-1.5">
        <DropdownMenuLabel className="text-muted-foreground px-1.5 text-[10px] font-medium tracking-[0.14em] uppercase">
          Environments
        </DropdownMenuLabel>

        {environments.map((item) => {
          const selected = item.key === current.key;

          return (
            <DropdownMenuItem
              key={item.key}
              disabled={pending}
              onSelect={() => {
                if (selected) return;
                select(item.key);
              }}
              className={cn(
                "gap-2.5 px-1.5 py-1.5",
                selected && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-md",
                  selected ? "bg-primary/10" : "bg-muted",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-2 rounded-full",
                    environmentColorSwatch[resolveEnvironmentColor(item.color)],
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium">
                  {item.name}
                </span>
                <span className="text-muted-foreground block truncate font-mono text-[10px]">
                  {item.key}
                </span>
              </span>
              {selected ? (
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
          <Link href="/environments/new">
            <PlusIcon aria-hidden="true" />
            Create environment
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/environments">
            <ServerIcon aria-hidden="true" />
            Manage environments
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
