"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { apiKeys, flags, segments } from "@/lib/api";

export function GlobalSearch({ projectKey, environmentKey }: { readonly projectKey: string; readonly environmentKey?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<Array<{ id: string; label: string; kind: string; href: string }>>([]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); input.current?.focus(); setOpen(true); }
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (!query.trim()) return;
    const timer = window.setTimeout(async () => {
      try {
        const options = { signal: controller.signal };
        const search = query.trim();
        const [flagPage, segmentPage, keyPage] = await Promise.all([
          flags.list(projectKey, { search, limit: 8, environmentKey }, options),
          segments.list(projectKey, { search, limit: 8 }, options),
          apiKeys.list(projectKey, { search, limit: 8, environmentKey }, options),
        ]);
        if (controller.signal.aborted) return;
        setResults([
          ...flagPage.data.map((item) => ({ id: `flag:${item.key}`, label: `${item.name} · ${item.key}`, kind: "Flag", href: `/projects/${projectKey}/flags/${item.key}${environmentKey ? `?environment=${encodeURIComponent(environmentKey)}` : ""}` })),
          ...segmentPage.data.map((item) => ({ id: `segment:${item.key}`, label: `${item.name} · ${item.key}`, kind: "Segment", href: `/segments/${item.key}` })),
          ...keyPage.data.map((item) => ({ id: `key:${item.id}`, label: item.name, kind: "API key", href: `/api-keys?search=${encodeURIComponent(item.name)}` })),
        ]);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Search failed. Try again.");
      } finally { if (!controller.signal.aborted) setBusy(false); }
    }, 200);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [query, projectKey, environmentKey]);
  return <div className="relative w-full max-w-xs" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <SearchIcon aria-hidden="true" className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
    <Input ref={input} type="search" aria-label="Search flags, segments and keys" aria-expanded={open} aria-controls="global-search-results" placeholder="Search this project…" maxLength={200} className="h-8 pl-8 pr-12 text-[13px]" value={query} onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setResults([]); setError(""); setBusy(!!event.target.value.trim()); setOpen(true); }} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); document.getElementById("global-search-results")?.querySelector<HTMLAnchorElement>("a")?.focus(); } }} />
    <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-[10px]">Ctrl/⌘K</kbd>
    {open && <section id="global-search-results" aria-label="Search results" className="absolute left-0 top-10 z-50 max-h-[70vh] w-80 max-w-[85vw] overflow-auto rounded-lg border bg-popover p-3 text-xs shadow-lg">
      <p className="mb-2 text-muted-foreground">Current project · {projectKey}</p>
      {!query.trim() ? <p>Type a flag, segment, or API key name.</p> : busy ? <p role="status">Searching…</p> : error ? <p role="alert">{error}</p> : !results.length ? <p>No matches.</p> : <ul>{results.map((item) => <li key={item.id}><Link className="block rounded p-2 hover:bg-muted focus:bg-muted" href={item.href} onClick={() => setOpen(false)}><span className="text-muted-foreground">{item.kind} · </span>{item.label}</Link></li>)}</ul>}
    </section>}
  </div>;
}
