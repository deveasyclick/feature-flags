"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateSegmentSchema, type TargetingCondition } from "@iwifunni/contracts";
import { ConditionList } from "@/components/app/targeting/condition-list";
import { Button } from "@/components/ui/button";
import { segments } from "@/lib/api";
import { conditionDraftsFrom, firstConditionError, newConditionDraft, toConditionInputs } from "@/lib/targeting";

export function SegmentConditionEditor({ projectKey, segmentKey, conditions, archived }: {
  readonly projectKey: string;
  readonly segmentKey: string;
  readonly conditions: TargetingCondition[];
  readonly archived: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(() => conditionDraftsFrom(conditions));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const issue = firstConditionError(drafts);
    if (issue) { setMessage(issue); return; }
    const parsed = updateSegmentSchema.safeParse({ rules: toConditionInputs(drafts) });
    if (!parsed.success) { setMessage(parsed.error.issues[0]?.message ?? "Check these conditions."); return; }
    setBusy(true); setMessage("");
    try {
      await segments.update(projectKey, segmentKey, parsed.data);
      setMessage("Segment conditions saved."); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save segment."); }
    finally { setBusy(false); }
  }
  return <section className="bg-card rounded-lg border p-4 space-y-4">
    <h2 className="text-[13px] font-medium">Edit segment conditions</h2>
    <p className="text-muted-foreground text-xs">All conditions must match. Saving updates flags that reference this segment. Segments used by protected environments cannot be changed directly.</p>
    <ConditionList conditions={drafts} disabled={busy || archived} groupLabel="All conditions must match" emptyLabel="No conditions. No users will match." onChange={(id, patch) => setDrafts((rows) => rows.map((row) => row.id === id ? { ...row, ...patch } : row))} onAdd={() => setDrafts((rows) => [...rows, newConditionDraft()])} onRemove={(id) => setDrafts((rows) => rows.filter((row) => row.id !== id))} />
    <div className="flex gap-2"><Button size="sm" disabled={busy || archived} onClick={save}>Save conditions</Button><Button size="sm" variant="outline" disabled={busy || archived} onClick={() => { setDrafts(conditionDraftsFrom(conditions)); setMessage(""); }}>Reset</Button></div>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
