import type { Metadata } from "next";
import Link from "next/link";
import { AuditLogView } from "@/components/app/audit-log/audit-log-view";
import { PageHeader } from "@/components/app/page-header";
import { loadAuditLog } from "./load-audit-log";

export const metadata: Metadata = {
  title: "Audit Log",
  description:
    "A complete, immutable record of every flag, segment, and key change.",
};

export const dynamic = "force-dynamic";

export default async function AuditLogPage({ searchParams }: { readonly searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  // One `now` for the whole render, so every relative label agrees.
  const auditLog = await loadAuditLog(new Date(), cursor);

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="A complete, immutable record of every flag, segment, and key change."
      />

      <p className="text-xs text-muted-foreground mb-3">Filters and export apply to this page of retained activity.</p>
      <AuditLogView key={cursor ?? "recent"} {...auditLog} />
      <nav aria-label="Audit log pages" className="mt-4 flex gap-4 text-sm">
        {cursor && <Link href="/audit-log">Most recent events</Link>}
        {auditLog.nextCursor && <Link href={`/audit-log?cursor=${encodeURIComponent(auditLog.nextCursor)}`}>Older events</Link>}
      </nav>
    </>
  );
}
