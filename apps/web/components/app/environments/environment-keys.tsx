"use client";

import Link from "next/link";
import { cn } from "cn";
import type { ApiKey, EnvironmentConnection } from "@iwifunni/contracts";
import { CopyButton } from "@/components/app/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/format";

/**
 * SDK keys and endpoints for one environment.
 *
 * A Client Component because copying a value needs clipboard access. The API
 * only ever returns a key's non-secret prefix outside the create response, so
 * every value rendered here is an identifier, not a credential.
 */

const kindLabels: Record<ApiKey["kind"], string> = {
  management: "Management",
  server: "Server",
  client: "Client",
};

/**
 * A non-secret key identifier with copy-to-clipboard.
 *
 * The value is passed in rather than derived here: the environment card shows
 * `connection.maskedKey`, while a key row shows that key's own prefix.
 */
export function MaskedKeyChip({
  value,
  label,
  className,
}: {
  readonly value: string | null;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "bg-muted flex min-w-0 items-center gap-2 rounded-md px-2.5 py-1.5",
        className,
      )}
    >
      <span className="truncate font-mono text-[11px]">
        {value ?? "No usable key"}
      </span>

      {value ? (
        <span className="ml-auto shrink-0">
          <CopyButton value={value} label={label} />
        </span>
      ) : null}
    </div>
  );
}

/** The keys that target this environment. */
export function SdkKeysCard({
  keys,
  maskedKey,
  truncated,
}: {
  readonly keys: ApiKey[];
  /** `connection.maskedKey` — shown when no key row targets this environment. */
  readonly maskedKey: string | null;
  readonly truncated: boolean;
}) {
  return (
    <section className="bg-card rounded-lg border">
      <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="text-[13px] font-medium">SDK keys</h2>
        <Button variant="link" size="sm" asChild className="text-[11px]">
          <Link href="/api-keys">Create key</Link>
        </Button>
      </header>

      {keys.length === 0 ? (
        <div className="space-y-2 p-4">
          <MaskedKeyChip value={maskedKey} label="environment key" />
          <p className="text-muted-foreground text-[11px]">
            No SDK key targets this environment yet. A key issued for the whole
            project still works here.
          </p>
        </div>
      ) : (
        <ul className="divide-y px-4">
          {keys.map((key) => (
            <li
              key={key.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[12px] font-medium">
                  {key.name}
                  <Badge variant="secondary" className="text-[10px]">
                    {kindLabels[key.kind]}
                  </Badge>
                </p>
                <p className="text-muted-foreground mt-0.5 text-[11px]">
                  Created {formatDate(key.createdAt)} ·{" "}
                  {key.lastUsedAt
                    ? `Last used ${formatDate(key.lastUsedAt)}`
                    : "Never used"}
                </p>
              </div>

              <div className="w-full min-w-0 sm:w-auto sm:min-w-[13rem]">
                <MaskedKeyChip
                  value={key.prefix}
                  label={`${key.name} prefix`}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {truncated ? (
        <p className="text-muted-foreground border-t px-4 py-2.5 text-[11px]">
          Showing the first {keys.length} keys.
        </p>
      ) : null}
    </section>
  );
}

interface EndpointRow {
  label: string;
  description: string;
  url: string;
}

/** Per-environment URLs an SDK points at. */
export function EndpointsCard({
  connection,
}: {
  readonly connection: EnvironmentConnection;
}) {
  const endpoints: EndpointRow[] = [
    {
      label: "Base URL",
      description: "Origin the SDK calls",
      url: connection.baseUrl,
    },
    {
      label: "Configuration",
      description: "The SDK downloads its snapshot here",
      url: `${connection.baseUrl}/v1/sdk/config`,
    },
  ];

  if (connection.streamUrl) {
    endpoints.push({
      label: "Streaming",
      description: "Live updates over SSE",
      url: connection.streamUrl,
    });
  }

  return (
    <section className="bg-card rounded-lg border">
      <header className="border-b px-4 py-3">
        <h2 className="text-[13px] font-medium">Endpoints</h2>
      </header>

      <ul className="divide-y px-4">
        {endpoints.map((endpoint) => (
          <li
            key={endpoint.label}
            className="flex flex-wrap items-center justify-between gap-3 py-3"
          >
            <div className="min-w-0">
              <p className="text-[12px] font-medium">{endpoint.label}</p>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                {endpoint.description}
              </p>
            </div>

            <div className="flex min-w-0 items-center gap-1">
              <span className="text-muted-foreground truncate font-mono text-[11px]">
                {endpoint.url}
              </span>
              <CopyButton value={endpoint.url} label={endpoint.label} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
