"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheckIcon,
  CircleXIcon,
  ClockIcon,
  LoaderCircleIcon,
} from "lucide-react";
import type { FlagChangeRequest } from "@iwifunni/contracts";
import { FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, changeRequests } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

interface FlagApprovalPanelProps {
  readonly projectKey: string;
  readonly flagKey: string;
  /** The pending proposal for this flag and environment, if there is one. */
  readonly request: FlagChangeRequest | null;
  /** Whether this environment refuses direct publishes. */
  readonly protectedEnvironment: boolean;
  /** An archived flag refuses every change, including an approved one. */
  readonly archived: boolean;
}

/**
 * The approval state of one flag in one environment.
 *
 * A protected environment cannot be written to directly, so this is where a
 * proposal waits and where a reviewer acts on it. `canDecide` comes from the
 * API rather than from a role this screen guesses at, so a reviewer never sees
 * a button the API would refuse.
 */
export function FlagApprovalPanel({
  projectKey,
  flagKey,
  request,
  protectedEnvironment,
  archived,
}: FlagApprovalPanelProps) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  if (!protectedEnvironment) return null;

  async function decide(decision: "approve" | "reject") {
    if (pending || archived || !request) return;
    setPending(true);
    setError(null);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const input = note.trim() ? { note: note.trim() } : {};

      if (decision === "approve") {
        await changeRequests.approve(projectKey, flagKey, request.id, input, {
          signal: controller.signal,
        });
      } else {
        await changeRequests.reject(projectKey, flagKey, request.id, input, {
          signal: controller.signal,
        });
      }

      setRejecting(false);
      setNote("");
      router.refresh();
    } catch (cause) {
      if ((cause as Error)?.name === "AbortError") return;

      setError(
        cause instanceof ApiError
          ? cause.message
          : "The decision could not be recorded. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!request) {
    return (
      <section className="border-info-ink/20 bg-info-ink/5 rounded-lg border p-4">
        <h2 className="text-info-ink text-[13px] font-medium">
          Protected environment
        </h2>
        <p className="text-muted-foreground mt-2 text-[11px] leading-5">
          This environment refuses direct flag changes. Publishing here proposes
          the change, and a project admin other than its author approves it
          before it takes effect.
        </p>
      </section>
    );
  }

  return (
    <section className="border-info-ink/20 bg-info-ink/5 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-info-ink flex items-center gap-1.5 text-[13px] font-medium">
            <ClockIcon aria-hidden="true" className="size-3.5" />
            Awaiting approval
          </h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {request.requestedByName ?? "Somebody"} proposed a change to{" "}
            {request.environmentName}{" "}
            {formatRelativeTime(request.requestedAt, new Date())}. Nothing has
            been published yet.
          </p>
          <p className="text-muted-foreground mt-1 font-mono text-[10px]">
            {describePayload(request)}
          </p>
        </div>
      </div>

      {rejecting ? (
        <div className="mt-3 space-y-2">
          <Textarea
            rows={2}
            disabled={archived}
            value={note}
            placeholder="Why is this being rejected?"
            aria-label="Rejection note"
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={pending || archived}
              onClick={() => decide("reject")}
              className="gap-1.5 text-[11px]"
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <CircleXIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Rejecting…" : "Reject change"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={pending || archived}
              onClick={() => setRejecting(false)}
              className="text-[11px]"
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : archived ? (
        <p className="text-muted-foreground mt-3 text-[11px]">
          This flag is archived, so this change cannot be applied. Restore the
          flag first.
        </p>
      ) : request.canDecide ? (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() => decide("approve")}
            className="gap-1.5 text-[11px]"
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <CheckCheckIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Approving…" : "Approve change"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || archived}
            onClick={() => setRejecting(true)}
            className="gap-1.5 text-[11px]"
          >
            <CircleXIcon aria-hidden="true" className="size-3.5" />
            Reject
          </Button>
        </div>
      ) : (
        <p className="text-muted-foreground mt-3 text-[11px]">
          A project admin other than the author has to approve this change.
        </p>
      )}

      {error ? (
        <div className="mt-2">
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
    </section>
  );
}

/** The proposal in one line, so a reviewer sees its shape before opening it. */
function describePayload(request: FlagChangeRequest): string {
  const parts = (["config", "rules", "targets"] as const).filter(
    (part) => request.payload[part] !== undefined,
  );

  const summary = request.payload.config
    ? ` enabled=${request.payload.config.enabled} rollout=${request.payload.config.rolloutPercentage}%`
    : "";

  return `${request.flagKey} · ${parts.join(" + ") || "nothing"}${summary}`;
}
