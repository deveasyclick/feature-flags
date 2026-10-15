import type { SegmentFlag, TargetingCondition } from "@iwifunni/contracts";
import { formatRelativeTime } from "@/lib/format";

/** Definition tab — the summary grid shown beside the conditions. */
export function SegmentSummaryCard({
  conditions,
  flags,
  updatedAt,
  now,
}: {
  readonly conditions: TargetingCondition[];
  readonly flags: SegmentFlag[];
  readonly updatedAt: string;
  readonly now: Date;
}) {
  const cells: Array<[string, string | number]> = [
    ["Conditions", conditions.length],
    ["Flags", flags.length],
    ["Updated", formatRelativeTime(updatedAt, now)],
    ["Type", "Dynamic"],
  ];

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">Summary</h2>

      <dl className="mt-3 grid grid-cols-2 gap-3">
        {cells.map(([label, value]) => (
          <div key={label} className="bg-muted/50 rounded-lg border p-3">
            <dt className="text-muted-foreground text-[11px]">{label}</dt>
            <dd className="mt-1 text-xl font-semibold tracking-tight">
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <p className="text-muted-foreground mt-3 border-t pt-3 text-[10px]">
        Membership is not shown here: the API exposes no endpoint that reports a
        segment&apos;s members.
      </p>
    </section>
  );
}
