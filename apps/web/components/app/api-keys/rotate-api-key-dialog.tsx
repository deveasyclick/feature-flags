"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, LoaderCircleIcon, TriangleAlertIcon } from "lucide-react";
import { ApiKeyCreatedNotice } from "@/components/app/api-keys/api-key-created-notice";
import type { ApiKeyView } from "@/components/app/api-keys/api-key-view";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CreatedApiKey } from "@iwifunni/contracts";
import { ApiError, apiKeys } from "@/lib/api";
import { capture } from "@/shared/analytics";

/**
 * The rotate flow for one key: confirm, then read the new secret.
 *
 * Keyed by the row it edits, so a key rotated earlier cannot leave its secret on
 * screen when the menu is reopened on another row.
 */
function RotateApiKeyBody({
  projectKey,
  apiKey,
  onClose,
}: {
  readonly projectKey: string;
  readonly apiKey: ApiKeyView;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [rotated, setRotated] = useState<CreatedApiKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  async function handleRotate() {
    if (pending) return;

    setError(null);
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const rotatedKey = await apiKeys.rotate(projectKey, apiKey.id, {
        signal: controller.signal,
      });
      capture("api_key_rotated");
      setRotated(rotatedKey);
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setError(
        caught instanceof ApiError
          ? caught.message
          : "The key could not be rotated. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  function close() {
    onClose();
    // The list's own query has to see the new tail.
    router.refresh();
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {rotated ? "Key rotated" : `Rotate ${apiKey.name}`}
        </DialogTitle>
        <DialogDescription>
          {rotated
            ? "Copy the new secret now. It cannot be read again."
            : "A new secret is issued for this key. The current one stops working immediately."}
        </DialogDescription>
      </DialogHeader>

      {rotated ? (
        <>
          <ApiKeyCreatedNotice name={rotated.name} secret={rotated.secret} />

          <div className="flex justify-end">
            <Button type="button" size="sm" onClick={close}>
              Done
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-muted-foreground flex items-start gap-2 text-[12px] leading-5">
            <TriangleAlertIcon
              aria-hidden="true"
              className="text-warn-ink mt-0.5 size-3.5 shrink-0"
            />
            Anything still using {apiKey.maskedKey} will fail until it is given
            the new secret.
          </p>

          {error ? <FieldError>{error}</FieldError> : null}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={close}>
              Cancel
            </Button>

            <Button
              type="button"
              size="sm"
              className="gap-1.5"
              disabled={pending}
              onClick={() => {
                void handleRotate();
              }}
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <KeyRoundIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Rotating…" : "Rotate key"}
            </Button>
          </div>
        </>
      )}
    </>
  );
}

/**
 * Replacing one key's secret from its row.
 *
 * Two steps, because it is destructive: confirming replaces the hash, and the
 * old secret stops working at that moment. The new secret is shown here and in
 * no other place afterwards.
 */
export function RotateApiKeyDialog({
  projectKey,
  apiKey,
  onClose,
}: {
  readonly projectKey: string;
  readonly apiKey: ApiKeyView | null;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open={apiKey !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        {apiKey ? (
          <RotateApiKeyBody
            key={apiKey.id}
            projectKey={projectKey}
            apiKey={apiKey}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
