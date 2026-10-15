"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PlusIcon } from "lucide-react";
import { ApiKeyCreatedNotice } from "@/components/app/api-keys/api-key-created-notice";
import { CreateApiKeyForm } from "@/components/app/api-keys/create-api-key-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { CreatedApiKey } from "@iwifunni/contracts";

/**
 * Creating a key, and reading it back, all inside one dialog.
 *
 * The secret is shown here rather than on the list behind it: it is the one
 * moment the API will ever return it, and a page that keeps it on screen after
 * the dialog closes is a secret left lying around.
 */
export function CreateApiKeyDialog({
  projectKey,
  environmentKey,
  environmentName,
}: {
  readonly projectKey: string;
  readonly environmentKey: string;
  readonly environmentName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  function close() {
    setOpen(false);
    setCreated(null);
  }

  function finish() {
    close();
    // The list's own query has to see the new row.
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else close();
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5 text-[11px]">
          <PlusIcon aria-hidden="true" className="size-3.5" />
          Create API Key
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Key created</DialogTitle>
              <DialogDescription>
                Copy it now. It cannot be read again.
              </DialogDescription>
            </DialogHeader>

            <ApiKeyCreatedNotice name={created.name} secret={created.secret} />

            <div className="flex justify-end">
              <Button type="button" size="sm" onClick={finish}>
                Done
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Create API key</DialogTitle>
              <DialogDescription>
                Issued into {environmentName}. The secret is shown once, here.
              </DialogDescription>
            </DialogHeader>

            {/* Mounted only while open, so reopening starts from a clean form. */}
            {open ? (
              <CreateApiKeyForm
                projectKey={projectKey}
                environmentKey={environmentKey}
                onCreated={setCreated}
                onCancel={close}
              />
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
