"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProjectSchema, updateSegmentSchema } from "@iwifunni/contracts";
import { projects, segments } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function EditResourceDialog({ kind, projectKey, resourceKey, name, description }: {
  readonly kind: "project" | "segment";
  readonly projectKey: string;
  readonly resourceKey: string;
  readonly name: string;
  readonly description: string | null;
}) {
  const id = useId();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const input = { name: form.get("name"), description: String(form.get("description") ?? "").trim() || null };
    const parsed = (kind === "project" ? updateProjectSchema : updateSegmentSchema).safeParse(input);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the details."); return; }
    setPending(true);
    setError(null);
    try {
      if (kind === "project") await projects.update(projectKey, parsed.data);
      else await segments.update(projectKey, resourceKey, parsed.data);
      setOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The changes could not be saved.");
    } finally { setPending(false); }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => { if (!pending) { setOpen(value); setError(null); } }}>
      <DialogTrigger asChild><Button variant="outline" size="sm">Edit {kind}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Edit {kind}</DialogTitle><DialogDescription>Update the name and description. The key stays the same.</DialogDescription></DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2"><Label htmlFor={`${id}-name`}>Name</Label><Input id={`${id}-name`} name="name" defaultValue={name} maxLength={80} required disabled={pending} /></div>
          <div className="space-y-2"><Label htmlFor={`${id}-description`}>Description</Label><Textarea id={`${id}-description`} name="description" defaultValue={description ?? ""} maxLength={280} disabled={pending} /></div>
          {error ? <p role="alert" className="text-sm text-danger-ink">{error}</p> : null}
          <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save changes"}</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
