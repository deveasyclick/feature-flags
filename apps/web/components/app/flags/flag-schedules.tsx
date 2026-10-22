"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScheduledFlagChange } from "@iwifunni/contracts";
import { flags } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FlagSchedules({ projectKey, flagKey, environmentKey, currentVersion }: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly environmentKey: string;
  readonly currentVersion: number | undefined;
}) {
  const router = useRouter();
  const [executeAt, setExecuteAt] = useState("");
  const [rollout, setRollout] = useState("100");
  const [enabled, setEnabled] = useState(true);
  const [schedules, setSchedules] = useState<ScheduledFlagChange[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    flags.schedules(projectKey, flagKey, environmentKey).then((page) => {
      if (active) { setSchedules(page.data); setNextCursor(page.nextCursor); }
    }).catch((error: unknown) => {
      if (active) setMessage(error instanceof Error ? error.message : "Unable to load schedules.");
    });
    return () => { active = false; };
  }, [projectKey, flagKey, environmentKey]);

  async function schedule(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentVersion) return;
    setBusy(true);
    setMessage("");
    try {
      const release = await flags.version(projectKey, flagKey, environmentKey, currentVersion);
      if (!release.state) throw new Error("Publish a configuration first to create a complete snapshot.");
      await flags.schedule(projectKey, flagKey, environmentKey, {
        executeAt: new Date(executeAt).toISOString(), baseVersion: currentVersion,
        payload: { config: { ...release.state.config, enabled, rolloutPercentage: Number(rollout) } },
      });
      const page = await flags.schedules(projectKey, flagKey, environmentKey);
      setSchedules(page.data);
      setNextCursor(page.nextCursor);
      setMessage("Change scheduled. It will stop if a newer version is published first.");
      router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to schedule change."); }
    finally { setBusy(false); }
  }

  async function cancel(id: string) {
    setBusy(true);
    setMessage("");
    try {
      await flags.cancelSchedule(projectKey, flagKey, environmentKey, id);
      setSchedules((rows) => rows.map((row) => row.id === id ? { ...row, status: "cancelled" } : row));
      setMessage("Schedule cancelled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to cancel schedule."); }
    finally { setBusy(false); }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setBusy(true);
    try {
      const page = await flags.schedules(projectKey, flagKey, environmentKey, { cursor: nextCursor });
      setSchedules((rows) => [...rows, ...page.data]); setNextCursor(page.nextCursor);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load schedules."); }
    finally { setBusy(false); }
  }

  return <section className="bg-card rounded-lg border p-4 space-y-3">
    <h2 className="text-[13px] font-medium">Scheduled changes</h2>
    <p className="text-muted-foreground text-xs">Schedule a configuration change in an unprotected environment. Times use your device’s timezone. The server checks schedules every 15 seconds.</p>
    <form onSubmit={schedule} className="space-y-3">
      <div className="space-y-2"><Label htmlFor="schedule-time">Publish at</Label><Input id="schedule-time" type="datetime-local" required value={executeAt} onChange={(event) => setExecuteAt(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="schedule-rollout">Rollout percentage</Label><Input id="schedule-rollout" type="number" min="0" max="100" required value={rollout} onChange={(event) => setRollout(event.target.value)} /></div>
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enable flag</label>
      <Button size="sm" variant="outline" disabled={busy || !currentVersion}>Schedule change</Button>
    </form>
    <ul className="space-y-2 text-xs">{schedules.map((row) => <li key={row.id} className="border rounded p-2 space-y-1">
      <p>{new Date(row.executeAt).toLocaleString()} · {row.status}</p>
      {row.failureReason && <p>{row.failureReason}</p>}
      {row.status === "pending" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => cancel(row.id)}>Cancel</Button>}
    </li>)}</ul>
    {nextCursor && <Button size="sm" variant="ghost" disabled={busy} onClick={loadMore}>Load more schedules</Button>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
