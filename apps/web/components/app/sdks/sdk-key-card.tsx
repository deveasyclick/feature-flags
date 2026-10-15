"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import { ApiKeyCreatedNotice } from "@/components/app/api-keys/api-key-created-notice";
import { SectionCard } from "@/components/app/page-header";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import {
  type CreatedApiKey,
  type SdkApiKeyKind,
} from "@iwifunni/contracts";
import { ApiError, apiKeys } from "@/lib/api";

/**
 * Issues the runtime key this screen's snippets need.
 *
 * The key is read-only and belongs to one environment, which is why the screen
 * asks for nothing else: the environment is the one the dashboard is scoped to,
 * and the scopes are fixed. The secret appears once, here.
 */
export function SdkKeyCard({
  projectKey,
  environmentKey,
  environmentName,
}: {
  readonly projectKey: string;
  readonly environmentKey: string;
  readonly environmentName: string;
}) {
  const router = useRouter();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [pending, setPending] = useState<SdkApiKeyKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function issue(kind: SdkApiKeyKind) {
    if (pending) return;

    setPending(kind);
    setError(null);

    try {
      const key = await apiKeys.create(projectKey, {
        name:
          kind === "client"
            ? `${environmentName} browser key`
            : `${environmentName} SDK key`,
        kind,
        environmentKey,
      });

      setCreated(key);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "The key could not be created. Please try again.",
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <SectionCard title="SDK key">
      <p className="text-muted-foreground text-[12px] leading-5">
        A server key authenticates a server-side SDK and a browser key one that
        ships to the client. Either way it reads {environmentName}&apos;s
        configuration and evaluates it locally; it can change nothing.
      </p>

      {created ? (
        <div className="mt-3">
          <ApiKeyCreatedNotice name={created.name} secret={created.secret} />
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          className="gap-1.5 text-[11px]"
          disabled={pending !== null}
          onClick={() => {
            void issue("server");
          }}
        >
          {pending === "server" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <KeyRoundIcon aria-hidden="true" className="size-3.5" />
          )}
          {pending === "server" ? "Creating…" : "Create server key"}
        </Button>

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 text-[11px]"
          disabled={pending !== null}
          onClick={() => {
            void issue("client");
          }}
        >
          {pending === "client" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          {pending === "client" ? "Creating…" : "Create browser key"}
        </Button>
      </div>

      {error ? (
        <div className="mt-3">
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </SectionCard>
  );
}
