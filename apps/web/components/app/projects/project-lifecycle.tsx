"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { projects } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ProjectLifecycle({ projectKey, name, archived = false }: { readonly projectKey: string; readonly name: string; readonly archived?: boolean }) {
  const router = useRouter();
  const [copyName, setCopyName] = useState(`${name} copy`);
  const [destination, setDestination] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function act(kind: "archive" | "restore" | "duplicate" | "transfer") {
    setPending(true); setMessage("");
    try {
      if (kind === "restore") { await projects.restore(projectKey); setMessage("Project restored. Issue new SDK keys before reconnecting applications."); router.refresh(); }
      else if (kind === "duplicate") { const copy = await projects.duplicate(projectKey, copyName); router.refresh(); router.push(`/projects/${copy.key}`); }
      else if (kind === "transfer") {
        const copy = await projects.transfer(projectKey, destination);
        setMessage(`Created ${copy.key} in ${destination} and archived the source.`);
        const memberships = await authClient.organization.list();
        const workspace = memberships.data?.find((item) => item.slug === destination.trim());
        if (workspace) {
          const result = await authClient.organization.setActive({ organizationId: workspace.id });
          if (result.error) throw new Error(`Transferred successfully. ${result.error.message ?? "Switch to the destination workspace to continue."}`);
          router.refresh(); router.push(`/projects/${copy.key}`);
        }
      }
      else { await projects.archive(projectKey); router.refresh(); router.push("/projects"); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update project."); }
    finally { setPending(false); }
  }
  return <section className="bg-card border rounded-lg p-4 space-y-3">
    <h2 className="text-sm font-medium">{archived ? `${name} · archived` : "Project lifecycle"}</h2>
    {archived ? <><p className="text-xs text-muted-foreground">Restoring preserves configuration. Previously revoked keys and cancelled schedules stay inactive.</p><Button size="sm" disabled={pending} onClick={() => act("restore")}>Restore project</Button></> : <>
      <details><summary className="text-sm cursor-pointer">Duplicate project</summary><div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Copy environments, flags, targeting, and segments. Flags start disabled and private. Keys, members, analytics, schedules, and old history are excluded.</p><Label htmlFor={`copy-${projectKey}`}>New project name</Label><Input id={`copy-${projectKey}`} value={copyName} maxLength={80} onChange={(event) => setCopyName(event.target.value)} /><Button size="sm" disabled={pending || !copyName.trim()} onClick={() => act("duplicate")}>Create copy</Button></div></details>
      <details><summary className="text-sm cursor-pointer">Transfer to another workspace</summary><div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">You must own both workspaces. Transfer creates an independent copy with flags disabled in the destination and archives this source. The source retains its history. Keys and memberships do not transfer.</p><Label htmlFor={`transfer-${projectKey}`}>Destination workspace slug</Label><Input id={`transfer-${projectKey}`} value={destination} onChange={(event) => setDestination(event.target.value)} /><Button size="sm" disabled={pending || !destination.trim()} onClick={() => act("transfer")}>Copy to destination and archive source</Button></div></details>
      <details><summary className="text-sm cursor-pointer">Archive project</summary><div className="mt-3 space-y-2"><p className="text-xs text-muted-foreground">Archiving revokes every SDK key and cancels pending schedules and approvals. Existing SDKs with old cached configurations stop serving them when they next refresh and receive a rejection. Restore the project later to recover its data.</p><label className="text-xs flex gap-2"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I understand applications will need new keys after restoration.</label><Button size="sm" variant="destructive" disabled={pending || !confirmed} onClick={() => act("archive")}>Archive project</Button></div></details>
    </>}
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
