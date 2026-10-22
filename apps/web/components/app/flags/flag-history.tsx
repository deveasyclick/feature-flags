import type { FlagVersion } from "@iwifunni/contracts";
import { Badge } from "@/components/ui/badge";
import { FlagVersionActions } from "./flag-version-actions";
import { FlagSchedules } from "./flag-schedules";
import { FlagRollbackControls } from "./flag-rollback-controls";
import { formatRelativeTime } from "@/lib/format";

export function FlagHistory({
  flagKey,
  projectKey,
  environmentKey,
  versions,
  environmentName,
  variationCount,
  rolloutPercentage,
  now,
}: {
  readonly flagKey: string;
  readonly projectKey: string;
  readonly environmentKey: string;
  readonly versions: FlagVersion[];
  readonly environmentName: string;
  readonly variationCount: number;
  readonly rolloutPercentage: number;
  readonly now: Date;
}) {
  const current = versions[0];

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
      <section className="bg-card rounded-lg border p-4">
        <h2 className="text-[13px] font-medium">Version history</h2>
        <p className="text-muted-foreground mt-1 text-[11px]">
          Every change to {flagKey}, newest first.
        </p>

        {versions.length === 0 ? (
          <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
            No recorded changes yet. This flag has not been modified since it was
            created.
          </p>
        ) : (
          <ol className="mt-4 space-y-1">
            {versions.map((version, index) => (
              <li
                key={version.version}
                className={
                  index === 0
                    ? "bg-primary/5 border-primary/30 rounded-lg border p-3"
                    : "rounded-lg p-3"
                }
              >
                <div className="flex flex-wrap items-start gap-3">
                  <span className="bg-muted text-muted-foreground mt-0.5 rounded-md px-1.5 py-0.5 font-mono text-[10px]">
                    v{version.version}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="text-[12px]">
                      {version.description ?? "No description recorded."}
                      {index === 0 ? (
                        <Badge variant="ok" className="ml-2 align-middle">
                          Current
                        </Badge>
                      ) : null}
                    </p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      {version.author} ·{" "}
                      {formatRelativeTime(version.createdAt, now)}
                    </p>
                  </div>

                  {version.serve ? (
                    <span className="text-muted-foreground shrink-0 font-mono text-[10px]">
                      {version.serve}
                    </span>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Current version</h2>

          {current ? (
            <>
              <div className="mt-3 flex items-center gap-2">
                <span className="bg-primary/10 text-primary rounded-md px-1.5 py-0.5 font-mono text-[10px]">
                  v{current.version}
                </span>
                <p className="text-[12px]">
                  {current.description ?? "No description recorded."}
                </p>
              </div>

              <dl className="mt-3 divide-y text-[12px]">
                {[
                  ["Author", current.author],
                  ["Published", formatRelativeTime(current.createdAt, now)],
                  ["Variations", `${variationCount}`],
                  ["Rollout", `${rolloutPercentage}% in ${environmentName}`],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between gap-4 py-2 first:pt-0 last:pb-0"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right capitalize">{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          ) : (
            <p className="text-muted-foreground mt-3 text-[12px]">
              No published version yet.
            </p>
          )}
        </section>

        <FlagVersionActions projectKey={projectKey} flagKey={flagKey} environmentKey={environmentKey} versions={versions} />
        <FlagSchedules projectKey={projectKey} flagKey={flagKey} environmentKey={environmentKey} currentVersion={current?.version} />
        <FlagRollbackControls projectKey={projectKey} flagKey={flagKey} environmentKey={environmentKey} versions={versions} />
      </div>
    </div>
  );
}
