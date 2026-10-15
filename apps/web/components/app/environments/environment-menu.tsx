"use client";

import Link from "next/link";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  CopyIcon,
  MoreHorizontalIcon,
  PencilIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { EnvironmentSummary } from "@iwifunni/contracts";

/**
 * The "more actions" menu for an environment.
 *
 * A Client Component because Radix needs to own the trigger's ref, which a
 * Server Component cannot hand over. Every item navigates: archiving revokes
 * credentials, so it is confirmed on the settings screen rather than fired
 * from a menu.
 */
export function EnvironmentMenu({
  environment,
}: {
  readonly environment: Pick<EnvironmentSummary, "key" | "name" | "archivedAt">;
}) {
  const settings = `/environments/${environment.key}/settings`;
  const archived = environment.archivedAt !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`More actions for ${environment.name}`}
        >
          <MoreHorizontalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel>{environment.name}</DropdownMenuLabel>
        <DropdownMenuItem asChild>
          <Link href={settings}>
            <PencilIcon aria-hidden="true" />
            Edit details
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/environments/new">
            <CopyIcon aria-hidden="true" />
            Duplicate environment
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href={settings} title="Confirmed on the settings screen">
            {archived ? (
              <ArchiveRestoreIcon aria-hidden="true" />
            ) : (
              <ArchiveIcon aria-hidden="true" />
            )}
            {archived ? "Restore environment" : "Archive environment"}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
