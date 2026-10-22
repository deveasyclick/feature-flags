"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export function WorkspaceSwitcher({ workspaceId }: { readonly workspaceId: string }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Array<{ id: string; name: string; slug: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    authClient.organization.list().then((result) => {
      if (!active) return;
      if (result.error) setError(result.error.message ?? "Unable to load workspaces.");
      else setWorkspaces(result.data ?? []);
    }).catch(() => { if (active) setError("Unable to load workspaces."); });
    return () => { active = false; };
  }, []);
  async function select(id: string) {
    setBusy(true); setError("");
    try {
      const result = await authClient.organization.setActive({ organizationId: id });
      if (result.error) throw new Error(result.error.message ?? "Unable to switch workspace.");
      router.refresh(); router.push("/overview");
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to switch workspace."); }
    finally { setBusy(false); }
  }
  if (workspaces.length < 2 && !error) return null;
  return <div className="text-xs"><select aria-label="Workspace" className="bg-background rounded border p-1.5 max-w-48" value={workspaceId} disabled={busy} onChange={(event) => select(event.target.value)}>{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name} ({workspace.slug})</option>)}</select>{error && <p role="alert">{error}</p>}</div>;
}
