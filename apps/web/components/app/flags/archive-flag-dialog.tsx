"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangleIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  LoaderCircleIcon,
} from "lucide-react";
import type { FlagSummary } from "@iwifunni/contracts";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, flags as flagsApi } from "@/lib/api";

/**
 * Archiving is project-wide, so the dialog states what every environment starts
 * serving before the write rather than after it.
 */
export function ArchiveFlagDialog({
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function handleArchive() {
    if (!flag || pending) return;

    setPending(true);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await flagsApi.archive(projectKey, flag.key, {
        signal: controller.signal,
      });
      onClose();
      router.refresh();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setError(
        caught instanceof ApiError
          ? caught.message
          : "The flag could not be archived. Please try again.",
      );
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
          <DialogTitle>Archive {flag?.name ?? "flag"}?</DialogTitle>
          <DialogDescription>
            Every environment of the project starts serving the off variation of{" "}
            <span className="font-mono">{flag?.key}</span>. Its variations,
            configurations and history are kept, and it can be restored later.
          </DialogDescription>
        </DialogHeader>

        {error ? <FieldError>{error}</FieldError> : null}

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
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => void handleArchive()}
            className="gap-1.5 text-[11px]"
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ArchiveIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Archiving…" : "Archive flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Restoring does not switch the flag on.
 *
 * Archive writes `status` alone, so every environment still holds the `enabled`
 * and rollout it had, and this dialog says so before the write rather than
 * letting a restore read as a rollback.
 */
export function RestoreFlagDialog({
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
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  async function handleRestore() {
    if (!flag || pending) return;

    setPending(true);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await flagsApi.unarchive(projectKey, flag.key, {
        signal: controller.signal,
      });
      onClose();
      router.refresh();
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setError(
        caught instanceof ApiError
          ? caught.message
          : "The flag could not be restored. Please try again.",
      );
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
          <DialogTitle>Restore {flag?.name ?? "flag"}?</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{flag?.key}</span> becomes active again in
            every environment, served exactly as it was switched before it was
            archived.
          </DialogDescription>
        </DialogHeader>

        {error ? <FieldError>{error}</FieldError> : null}

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
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => void handleRestore()}
            className="gap-1.5 text-[11px]"
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <ArchiveRestoreIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Restoring…" : "Restore flag"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The danger-zone row of the flag detail screen. */
export function ArchiveFlagAction({
  projectKey,
  flag,
}: {
  readonly projectKey: string;
  readonly flag: FlagSummary;
}) {
  const [open, setOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  if (flag.status === "archived") {
    return (
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[12px] font-medium">Restore flag</p>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            Every environment serves the off variation while the flag is
            archived, and its configuration is read-only. Restoring makes it
            active again with the state it had before.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setRestoring(true)}
          className="gap-1.5 text-[11px]"
        >
          <ArchiveRestoreIcon aria-hidden="true" className="size-3.5" />
          Restore Flag
        </Button>
        <RestoreFlagDialog
          projectKey={projectKey}
          flag={restoring ? flag : null}
          onClose={() => setRestoring(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-[12px] font-medium">Archive flag</p>
        <p className="text-muted-foreground mt-0.5 text-[11px]">
          Every environment serves the off variation as soon as it is archived.
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-danger-ink/40 text-danger-ink gap-1.5 text-[11px]"
      >
        <AlertTriangleIcon aria-hidden="true" className="size-3.5" />
        Archive Flag
      </Button>
      <ArchiveFlagDialog
        projectKey={projectKey}
        flag={open ? flag : null}
        onClose={() => setOpen(false)}
      />
    </div>
  );
}
