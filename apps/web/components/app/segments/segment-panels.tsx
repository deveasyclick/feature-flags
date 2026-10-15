import Link from "next/link";
import { LayersIcon } from "lucide-react";
import { cn } from "cn";
import type { SegmentFlag, TargetingCondition } from "@iwifunni/contracts";
import { SegmentGlyph } from "@/components/app/segments/segment-glyph";
import {
  matchingSampleUsers,
  sampleAudience,
} from "@/components/app/segments/segment-sample";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { operatorLabels, valuesLabel } from "@/lib/targeting";

const headerClass =
  "text-muted-foreground h-8 px-3 text-[10px] font-medium tracking-[0.1em] uppercase";
const cellClass = "px-3 py-2.5 text-[12px]";

const flagStatusPresentation: Record<
  SegmentFlag["status"],
  { label: string; variant: "ok" | "outline" }
> = {
  active: { label: "Active", variant: "ok" },
  archived: { label: "Archived", variant: "outline" },
};

export function FlagEnvironmentBadge({
  environmentKey,
}: {
  readonly environmentKey: string;
}) {
  return (
    <span className="bg-muted text-muted-foreground inline-flex rounded-md px-2 py-0.5 text-[10px] capitalize">
      {environmentKey}
    </span>
  );
}

export function FlagStatusBadge({ flag }: { readonly flag: SegmentFlag }) {
  const presentation = flagStatusPresentation[flag.status];

  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge variant={presentation.variant}>{presentation.label}</Badge>
      {flag.isRollout ? <Badge variant="warn">Rollout</Badge> : null}
    </span>
  );
}

/** Definition tab — the segment's conditions as a read-only table. */
export function SegmentRuleTable({
  conditions,
}: {
  readonly conditions: TargetingCondition[];
}) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">Segment conditions</h2>

      {conditions.length === 0 ? (
        <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
          This segment has no conditions, so no user matches it.
        </p>
      ) : (
        <Table className="mt-3">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={headerClass}>Attribute</TableHead>
              <TableHead className={headerClass}>Operator</TableHead>
              <TableHead className={headerClass}>Value</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {conditions.map((condition) => (
              <TableRow key={condition.id} className="hover:bg-transparent">
                <TableCell className={cn(cellClass, "font-mono text-[11px]")}>
                  {condition.attribute}
                  <span className="text-muted-foreground block font-sans text-[10px]">
                    {condition.attributeType}
                  </span>
                </TableCell>
                <TableCell className={cn(cellClass, "text-muted-foreground")}>
                  {operatorLabels[condition.operator]}
                </TableCell>
                <TableCell className={cn(cellClass, "font-mono text-[11px]")}>
                  {valuesLabel(condition.values)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Definition tab — the flags that reference this segment. */
export function SegmentUsedByFlags({ flags }: { readonly flags: SegmentFlag[] }) {
  return (
    <section className="bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[13px] font-medium">Used by flags</h2>
        <span className="text-muted-foreground text-[11px]">
          {flags.length} flag{flags.length === 1 ? "" : "s"}
        </span>
      </div>

      {flags.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-[12px]">
          No flags reference this segment yet.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {flags.map((flag) => (
            <li
              key={`${flag.key}-${flag.environmentKey}`}
              className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
            >
              <SegmentGlyph segmentKey={flag.key} className="size-6" />
              <Link
                href={`/environments/${flag.environmentKey}/flags/${flag.key}`}
                className="hover:text-primary flex-1 font-mono text-[12px] transition-colors"
              >
                {flag.key}
              </Link>
              <FlagEnvironmentBadge environmentKey={flag.environmentKey} />
              <FlagStatusBadge flag={flag} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Members tab.
 *
 * The API has no membership endpoint, so there is nothing real to list. The
 * rows are a local sample estimate and the header says so.
 */
export function SegmentMembers({
  conditions,
}: {
  readonly conditions: TargetingCondition[];
}) {
  const members = matchingSampleUsers(conditions);

  return (
    <section className="bg-card rounded-lg border">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
        <div>
          <h2 className="text-[13px] font-medium">Members</h2>
          <p className="text-muted-foreground mt-0.5 max-w-2xl text-[11px]">
            Sample estimate. The API exposes no membership endpoint, so these
            rows are evaluated locally against a fixed sample audience — not
            this project&apos;s real users.
          </p>
        </div>
        <span className="text-muted-foreground text-[11px]">
          {members.length} of {sampleAudience.length} sample users
        </span>
      </header>

      {members.length === 0 ? (
        <p className="text-muted-foreground p-4 text-[12px]">
          No sample users match these conditions.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={headerClass}>User</TableHead>
              <TableHead className={headerClass}>Plan</TableHead>
              <TableHead className={headerClass}>Region</TableHead>
              <TableHead className={cn(headerClass, "text-right")}>
                Sessions
              </TableHead>
              <TableHead className={cn(headerClass, "text-right")}>Beta</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((user) => (
              <TableRow key={user.id}>
                <TableCell className={cellClass}>
                  <span className="block font-mono text-[11px]">{user.id}</span>
                  <span className="text-muted-foreground block text-[11px]">
                    {user.email}
                  </span>
                </TableCell>
                <TableCell className={cellClass}>{user.plan}</TableCell>
                <TableCell className={cellClass}>{user.region}</TableCell>
                <TableCell className={cn(cellClass, "text-right")}>
                  {user.sessions}
                </TableCell>
                <TableCell className={cn(cellClass, "text-right")}>
                  {user.beta ? (
                    <Badge variant="ok">true</Badge>
                  ) : (
                    <Badge variant="outline">false</Badge>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

/** Flags tab — every flag and environment that references this segment. */
export function SegmentFlags({ flags }: { readonly flags: SegmentFlag[] }) {
  return (
    <section className="bg-card rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="text-[13px] font-medium">Flags using this segment</h2>
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          One row per flag and environment whose targeting rules reference this
          segment key.
        </p>
      </header>

      {flags.length === 0 ? (
        <p className="text-muted-foreground p-4 text-[12px]">
          No flags reference this segment yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className={headerClass}>Flag</TableHead>
              <TableHead className={headerClass}>Environment</TableHead>
              <TableHead className={headerClass}>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.map((flag) => (
              <TableRow key={`${flag.key}-${flag.environmentKey}`}>
                <TableCell className={cellClass}>
                  <Link
                    href={`/environments/${flag.environmentKey}/flags/${flag.key}`}
                    className="hover:text-primary inline-flex items-center gap-2 font-mono text-[12px] transition-colors"
                  >
                    <LayersIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-3.5"
                    />
                    {flag.key}
                  </Link>
                </TableCell>
                <TableCell className={cellClass}>
                  <FlagEnvironmentBadge environmentKey={flag.environmentKey} />
                </TableCell>
                <TableCell className={cellClass}>
                  <FlagStatusBadge flag={flag} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
