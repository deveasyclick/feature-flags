"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BellIcon } from "lucide-react";
import type { Notification } from "@iwifunni/contracts";
import { notifications } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, []);
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function load(more = false) {
    setBusy(true); setError("");
    try {
      const page = await notifications.list(more && cursor ? { cursor } : {});
      setItems((rows) => more ? [...rows, ...page.data] : page.data); setCursor(page.nextCursor); setCount(page.unreadCount);
    } catch (error) { setError(error instanceof Error ? error.message : "Unable to load notifications."); }
    finally { setBusy(false); }
  }
  async function read(id: string) {
    if (busy || items.find((item) => item.id === id)?.read) return;
    setBusy(true); setError("");
    try { await notifications.markRead(id); setItems((rows) => rows.map((row) => row.id === id ? { ...row, read: true } : row)); setCount((value) => Math.max(0, (value ?? 1) - 1)); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to mark notification read."); }
    finally { setBusy(false); }
  }
  return <div ref={root} className="relative"><Button size="sm" variant="ghost" aria-label="Notifications" aria-expanded={open} onClick={() => { if (!open) void load(); setOpen(!open); }}><BellIcon className="size-4" />{count !== null && count > 0 && <span className="text-xs">{count}</span>}</Button>
    {open && <section aria-label="Notification inbox" className="absolute right-0 top-10 z-50 w-80 max-w-[90vw] max-h-[75vh] overflow-auto rounded-lg border bg-popover p-4 shadow-lg space-y-3"><h2 className="text-sm font-medium">Notifications {count !== null && `· ${count} unread`}</h2><p className="text-xs text-muted-foreground">Approval decisions, failed schedules, and project lifecycle changes.</p>{!items.length && !busy && !error && <p className="text-xs">No notifications yet.</p>}<ul className="space-y-3">{items.map((item) => <li key={item.id} className="border-t pt-2 space-y-1 text-xs"><Link href={item.href} onClick={() => { if (!item.read) void read(item.id); setOpen(false); }} className={item.read ? "text-muted-foreground" : "font-medium"}>{item.title}</Link><p className="text-muted-foreground">{item.projectName ?? "Workspace"} · {new Date(item.createdAt).toLocaleString()}</p>{!item.read && <Button size="sm" variant="ghost" disabled={busy} onClick={() => read(item.id)}>Mark read</Button>}</li>)}</ul>{cursor && <Button variant="outline" size="sm" disabled={busy} onClick={() => load(true)}>Load more</Button>}{busy && <p role="status" className="text-xs">Loading…</p>}{error && <p role="alert" className="text-xs">{error}</p>}</section>}
  </div>;
}
