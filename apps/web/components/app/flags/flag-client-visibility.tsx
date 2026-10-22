"use client";

import { useState } from "react";
import { flags } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function FlagClientVisibility({ projectKey, flagKey, initialVisible }: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly initialVisible: boolean;
}) {
  const [visible, setVisible] = useState(initialVisible);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function toggle() {
    setBusy(true);
    setMessage("");
    try {
      const result = await flags.setClientVisibility(projectKey, flagKey, !visible);
      setVisible(result.clientVisible);
      setMessage(result.clientVisible ? "Browser delivery enabled." : "Browser delivery disabled.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to update browser delivery."); }
    finally { setBusy(false); }
  }
  return <section className="bg-card rounded-lg border p-4 space-y-3">
    <h2 className="text-[13px] font-medium">Browser delivery · {visible ? "enabled" : "disabled"}</h2>
    <p className="text-muted-foreground text-xs">Browser-visible flags expose their evaluated values through client keys in every environment. Browser identities and attributes can be changed by the caller; use server-side authorization for access decisions.</p>
    <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>{visible ? "Disable browser delivery" : "Make values browser-visible"}</Button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </section>;
}
