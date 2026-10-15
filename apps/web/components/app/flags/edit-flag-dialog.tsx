"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon, PencilIcon, TagIcon, XIcon } from "lucide-react";
import {
  toFieldErrors,
  updateFlagSchema,
  type FieldErrors,
  type FlagSummary,
  type UpdateFlagInput,
} from "@iwifunni/contracts";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, flags as flagsApi } from "@/lib/api";

type EditFlagField = keyof UpdateFlagInput;
type EditFlagErrors = FieldErrors<EditFlagField>;

/**
 * The flag's identity — name, description, owner and tags. The key and the type
 * are immutable, which is why neither is a control here; what the flag does in
 * an environment belongs to the configuration screen.
 */
export function EditFlagDialog({
  projectKey,
  flag,
  onClose,
}: {
  readonly projectKey: string;
  /** The row that asked for the dialog; `null` keeps it closed. */
  readonly flag: FlagSummary | null;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [owner, setOwner] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [errors, setErrors] = useState<EditFlagErrors>({});
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setName(flag?.name ?? "");
    setDescription(flag?.description ?? "");
    setOwner(flag?.owner ?? "");
    setTags(flag?.tags ?? []);
    setTagDraft("");
    setErrors({});
  }, [flag]);

  function clearError(field: EditFlagField) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  function addTag(value: string) {
    const tag = value.trim();

    if (!tag || tags.includes(tag)) return;

    setTags((previous) => [...previous, tag]);
    clearError("tags");
    setTagDraft("");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!flag || pending) return;

    const parsed = updateFlagSchema.safeParse({
      name: name.trim(),
      description: description.trim() || null,
      owner: owner.trim() || null,
      tags,
    });

    if (!parsed.success) {
      setErrors(toFieldErrors<EditFlagField>(parsed.error));
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await flagsApi.update(projectKey, flag.key, parsed.data, {
        signal: controller.signal,
      });
      onClose();
      router.refresh();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setErrors((previous) => ({
        ...previous,
        form:
          caught instanceof ApiError
            ? caught.message
            : "The flag could not be saved. Please try again.",
      }));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={flag !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit flag</DialogTitle>
          <DialogDescription>
            The identity of <span className="font-mono">{flag?.key}</span>. Its
            key and type cannot be changed.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            id="edit-flag-name"
            label="Name"
            required
            value={name}
            error={errors.name}
            onChange={(event) => {
              setName(event.target.value);
              clearError("name");
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="edit-flag-description">Description</Label>
            <Textarea
              id="edit-flag-description"
              rows={3}
              maxLength={280}
              placeholder="What this flag controls and when it can be removed."
              value={description}
              onChange={(event) => {
                setDescription(event.target.value);
                clearError("description");
              }}
            />
            {errors.description ? (
              <FieldError>{errors.description}</FieldError>
            ) : null}
          </div>

          <Field
            id="edit-flag-owner"
            label="Owner"
            placeholder="The team or person accountable for this flag"
            value={owner}
            error={errors.owner}
            onChange={(event) => {
              setOwner(event.target.value);
              clearError("owner");
            }}
          />

          <div className="space-y-2">
            <Label htmlFor="edit-flag-tag">Tags</Label>
            <div className="flex flex-wrap items-center gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="bg-muted inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px]"
                >
                  {tag}
                  <button
                    type="button"
                    aria-label={`Remove tag ${tag}`}
                    onClick={() =>
                      setTags((previous) =>
                        previous.filter((item) => item !== tag),
                      )
                    }
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <XIcon aria-hidden="true" className="size-3" />
                  </button>
                </span>
              ))}

              <div className="flex items-center gap-1.5">
                <TagIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-3.5"
                />
                <Input
                  id="edit-flag-tag"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addTag(tagDraft);
                    }
                  }}
                  aria-label="Add a tag"
                  placeholder="Add Tag"
                  className="h-7 w-28 text-[11px]"
                />
              </div>
            </div>
            {errors.tags ? <FieldError>{errors.tags}</FieldError> : null}
          </div>

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={onClose}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={pending}
              className="gap-1.5 text-[11px]"
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <PencilIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** The detail header is a Server Component, so its trigger owns the dialog state. */
export function EditFlagButton({
  projectKey,
  flag,
}: {
  readonly projectKey: string;
  readonly flag: FlagSummary;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        size="sm"
        className="gap-1.5 text-[11px]"
        onClick={() => setOpen(true)}
      >
        <PencilIcon aria-hidden="true" className="size-3.5" />
        Edit Flag
      </Button>
      <EditFlagDialog
        projectKey={projectKey}
        flag={open ? flag : null}
        onClose={() => setOpen(false)}
      />
    </>
  );
}
