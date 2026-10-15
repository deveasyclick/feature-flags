"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LoaderCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  SearchIcon,
} from "lucide-react";
import { cn } from "cn";
import type { SegmentSummary } from "@iwifunni/contracts";
import { SegmentGlyph } from "@/components/app/segments/segment-glyph";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatRelativeTime } from "@/lib/format";

const SEARCH_DEBOUNCE_MS = 250;

const headerClass =
  "text-muted-foreground h-8 px-3 text-[10px] font-medium tracking-[0.1em] uppercase";
const cellClass = "px-3 py-2.5 text-[12px]";

interface SegmentListProps {
  readonly segments: SegmentSummary[];
  readonly search: string;
  readonly nextCursor: string | null;
  /** Passed in so relative labels stay stable across hydration. */
  readonly now: string;
}

export function SegmentList({
  segments,
  search,
  nextCursor,
  now,
}: SegmentListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(search);
  const [pending, startTransition] = useTransition();
  const nowDate = useMemo(() => new Date(now), [now]);
  const lastServerSearch = useRef(search);

  // Keeps the input in step with history navigation, which changes `search`
  // without going through this component.
  useEffect(() => {
    if (lastServerSearch.current === search) return;
    lastServerSearch.current = search;
    setQuery(search);
  }, [search]);

  useEffect(() => {
    const next = query.trim();
    if (next === search.trim()) return;

    const timer = setTimeout(() => {
      const params = new URLSearchParams();
      if (next) params.set("q", next);
      const tail = params.toString();

      startTransition(() =>
        router.replace(tail ? `${pathname}?${tail}` : pathname),
      );
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, search, pathname, router, startTransition]);

  return (
    <section className="bg-card rounded-lg border">
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:items-center">
        <div className="relative w-full sm:max-w-xs">
          <SearchIcon
            aria-hidden="true"
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search segments by name or key"
            placeholder="Search segments by name or key…"
            className="h-8 pl-8 text-[13px]"
          />
        </div>

        <p className="text-muted-foreground flex items-center gap-1.5 text-[11px] sm:ml-auto">
          {pending ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className="size-3.5 animate-spin"
            />
          ) : null}
          {segments.length} segment{segments.length === 1 ? "" : "s"}
        </p>
      </div>

      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className={headerClass}>Segment</TableHead>
            <TableHead className={cn(headerClass, "text-right")}>
              Conditions
            </TableHead>
            <TableHead className={headerClass}>Updated</TableHead>
            <TableHead className={cn(headerClass, "w-16 text-right")}> </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {segments.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={4}
                className="text-muted-foreground py-10 text-center text-[12px]"
              >
                {search
                  ? `No segments match "${search}".`
                  : "This project has no segments yet."}
              </TableCell>
            </TableRow>
          ) : (
            segments.map((segment) => (
              <TableRow key={segment.key}>
                <TableCell className={cellClass}>
                  <div className="flex items-start gap-2.5">
                    <SegmentGlyph segmentKey={segment.key} />
                    <div className="min-w-0">
                      <Link
                        href={`/segments/${segment.key}`}
                        className="hover:text-primary block text-[12px] font-medium transition-colors"
                      >
                        {segment.name}
                      </Link>
                      <span className="text-muted-foreground block text-[11px]">
                        <span className="font-mono">{segment.key}</span>
                        {segment.description ? ` · ${segment.description}` : ""}
                      </span>
                    </div>
                  </div>
                </TableCell>

                <TableCell className={cn(cellClass, "text-right font-medium")}>
                  {segment.conditionCount}
                </TableCell>

                <TableCell className={cn(cellClass, "text-muted-foreground")}>
                  {formatRelativeTime(segment.updatedAt, nowDate)}
                </TableCell>

                <TableCell className={cn(cellClass, "text-right")}>
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${segment.name}`}
                      title="Edit — coming soon"
                      disabled
                    >
                      <PencilIcon aria-hidden="true" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`More actions for ${segment.name}`}
                        >
                          <MoreHorizontalIcon aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel>{segment.name}</DropdownMenuLabel>
                        <DropdownMenuItem disabled>Edit segment</DropdownMenuItem>
                        <DropdownMenuItem disabled>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem disabled>Archive</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {nextCursor ? (
        <p className="text-muted-foreground border-t px-3 py-2 text-[11px]">
          Showing the first {segments.length} segments. Refine the search to
          narrow the list.
        </p>
      ) : null}
    </section>
  );
}
