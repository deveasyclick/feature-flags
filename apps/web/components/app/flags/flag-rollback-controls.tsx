"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { armFlagRollbackSchema, type FlagVersion, type FlagRollbackPolicy } from "@iwifunni/contracts";
import { flags } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function FlagRollbackControls({ projectKey, flagKey, environmentKey, versions }: { readonly projectKey: string; readonly flagKey: string; readonly environmentKey: string; readonly versions: FlagVersion[] }) {
  const router = useRouter();
  const [target, setTarget] = useState(String(versions[1]?.version ?? ""));
  const [percentage, setPercentage] = useState("20");
  const [samples, setSamples] = useState("100");
  const [minutes, setMinutes] = useState("5");
  const [policies, setPolicies] = useState<FlagRollbackPolicy[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const current = versions[0]?.version;
  useEffect(() => {
    let active = true;
    flags.rollbackPolicies(projectKey, flagKey, environmentKey).then((page) => { if (active) { setPolicies(page.data); setCursor(page.nextCursor); } }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Unable to load policies."); });
    return () => { active = false; };
  }, [projectKey, flagKey, environmentKey]);
  async function load(more = false) {
    const page = await flags.rollbackPolicies(projectKey, flagKey, environmentKey, more && cursor ? { cursor } : {});
    setPolicies((rows) => more ? [...rows, ...page.data] : page.data); setCursor(page.nextCursor);
  }
  async function act(kind: "arm" | "refresh" | "more" | "cancel", id?: string) {
    setBusy(true); setMessage("");
    try {
      if (kind === "arm") {
        const parsed = armFlagRollbackSchema.safeParse({ currentVersion: current, targetVersion: Number(target), errorPercentage: Number(percentage), minimumSamples: Number(samples), windowMinutes: Number(minutes) });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check policy settings.");
        await flags.armRollback(projectKey, flagKey, environmentKey, parsed.data);
        setMessage("Monitoring armed for one hour. Only explicitly reported outcomes for this version count.");
      } else if (kind === "cancel" && id) await flags.cancelRollback(projectKey, flagKey, environmentKey, id);
      await load(kind === "more");
      if (kind === "refresh") router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update policy."); }
    finally { setBusy(false); }
  }
  return <section className="bg-card border rounded-lg p-4 space-y-3"><h2 className="text-sm font-medium">Automatic rollback</h2>
    <p className="text-xs text-muted-foreground">For unprotected environments. The Node SDK must report application outcomes with trackOutcome. Monitoring lasts one hour and stops if the flag changes. Rollback restores configuration, rules, and targets; variation values and segment definitions retain their current values.</p>
    <div className="space-y-2"><Label htmlFor="rollback-target">Restore version</Label><select id="rollback-target" className="bg-background w-full border rounded p-2 text-xs" value={target} onChange={(event) => setTarget(event.target.value)}>{versions.filter((version) => current && version.version < current).map((version) => <option key={version.version} value={version.version}>v{version.version}</option>)}</select></div>
    <div className="grid grid-cols-3 gap-2">{[["Error %", percentage, setPercentage, 1, 100], ["Min outcomes", samples, setSamples, 10, 100000], ["Window (min)", minutes, setMinutes, 1, 60]].map(([label, value, setter, min, max]) => <div key={String(label)} className="space-y-2"><Label htmlFor={`rollback-${label}`}>{String(label)}</Label><Input id={`rollback-${label}`} type="number" min={Number(min)} max={Number(max)} value={String(value)} onChange={(event) => (setter as (value: string) => void)(event.target.value)} /></div>)}</div>
    <div className="flex gap-2"><Button size="sm" disabled={busy || !target || policies.some((row) => row.status === "armed")} onClick={() => act("arm")}>Arm monitoring</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => act("refresh")}>Refresh status</Button></div>
    <ul className="space-y-2 text-xs">{policies.map((row) => <li key={row.id} className="border rounded p-2"><p>v{row.currentVersion} → v{row.targetVersion} · {row.status}</p><p>{row.errorPercentage}% errors from at least {row.minimumSamples} outcomes over {row.windowMinutes} minutes</p>{row.reason && <p>{row.reason}</p>}{row.status === "armed" && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("cancel", row.id)}>Cancel monitoring</Button>}</li>)}</ul>
    {cursor && <Button size="sm" variant="ghost" disabled={busy} onClick={() => act("more")}>Load more policies</Button>}{message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
