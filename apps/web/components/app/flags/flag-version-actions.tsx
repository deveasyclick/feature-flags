"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FlagVersion, FlagVersionDetail } from "@iwifunni/contracts";
import { ApiError, changeRequests, flags } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function FlagVersionActions({ projectKey, flagKey, environmentKey, versions }: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly environmentKey: string;
  readonly versions: FlagVersion[];
}) {
  const router = useRouter();
  const [from, setFrom] = useState(String((versions[1] ?? versions[0])?.version ?? ""));
  const [to, setTo] = useState(String(versions[0]?.version ?? ""));
  const [comparison, setComparison] = useState<[FlagVersionDetail, FlagVersionDetail] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [approval, setApproval] = useState(false);

  async function compare() {
    setBusy(true);
    setMessage("");
    setComparison(null);
    setApproval(false);
    try {
      const result = await Promise.all([
        flags.version(projectKey, flagKey, environmentKey, Number(from)),
        flags.version(projectKey, flagKey, environmentKey, Number(to)),
      ]);
      setComparison(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load versions.");
    } finally { setBusy(false); }
  }

  async function restore(propose: boolean) {
    const release = comparison?.[0];
    if (!release?.state) return;
    setBusy(true);
    setMessage("");
    try {
      if (propose) {
        await changeRequests.create(projectKey, flagKey, { environmentKey, payload: release.state });
        setMessage(`Restoring v${release.version} has been submitted for approval.`);
      } else {
        await flags.restoreVersion(projectKey, flagKey, environmentKey, release.version);
        setMessage(`Restored the configuration, rules, and targets from v${release.version}.`);
      }
      setApproval(false);
      router.refresh();
    } catch (error) {
      if (error instanceof ApiError && error.code === "approval_required") setApproval(true);
      setMessage(error instanceof Error ? error.message : "Unable to restore this version.");
    } finally { setBusy(false); }
  }

  return <section className="bg-card rounded-lg border p-4 space-y-3">
    <h2 className="text-[13px] font-medium">Compare and restore versions</h2>
    <div className="grid grid-cols-2 gap-3">
      {([ ["From", from, setFrom], ["To", to, setTo] ] as const).map(([label, value, onChange]) => <div key={label} className="space-y-2">
        <Label htmlFor={`version-${label}`}>{label}</Label>
        <select id={`version-${label}`} value={value} onChange={(event) => { onChange(event.target.value); setComparison(null); setApproval(false); }} className="bg-background w-full rounded-md border p-2 text-xs" disabled={busy}>
          {versions.map((version) => <option key={version.version} value={version.version}>v{version.version}</option>)}
        </select>
      </div>)}
    </div>
    <Button variant="outline" size="sm" disabled={busy || !from || !to || from === to} onClick={compare}>Compare versions</Button>
    {comparison && <div className="space-y-3 text-xs">
      {comparison.some((release) => !release.state) ? <p>A selected version predates complete snapshots. Comparison and restoration are unavailable.</p> : <>
        {(["config", "rules", "targets"] as const).map((part) => {
          const before = JSON.stringify(comparison[0].state?.[part], null, 2);
          const after = JSON.stringify(comparison[1].state?.[part], null, 2);
          return <details key={part}><summary className="cursor-pointer capitalize">{part} · {before === after ? "unchanged" : "changed"}</summary>
            <div className="grid gap-2 mt-2"><p>v{comparison[0].version}</p><pre className="bg-muted overflow-auto rounded p-2 max-h-64">{before}</pre><p>v{comparison[1].version}</p><pre className="bg-muted overflow-auto rounded p-2 max-h-64">{after}</pre></div>
          </details>;
        })}
        <p>Restore replaces this environment’s configuration, rules, and individual targets. Variation values and segment definitions retain their current values.</p>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => restore(approval)}>{approval ? `Propose restoring v${comparison[0].version}` : `Restore v${comparison[0].version}`}</Button>
      </>}
    </div>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
