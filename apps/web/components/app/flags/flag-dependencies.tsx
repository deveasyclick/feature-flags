import { CheckCircle2Icon, GitBranchIcon, LayersIcon } from "lucide-react";
import type { FlagDependencyGraph, FlagStatus } from "@iwifunni/contracts";
import { cn } from "cn";

function GraphNode({
  flagKey,
  meta,
  tone,
  chip,
}: {
  readonly flagKey: string;
  readonly meta: string;
  readonly tone: "upstream" | "self" | "downstream";
  readonly chip?: string;
}) {
  return (
    <div
      className={cn(
        "bg-card flex min-w-40 flex-col rounded-lg border px-3 py-2",
        tone === "self" && "border-primary/40 bg-primary/5",
      )}
    >
      <span className="flex items-center gap-1.5">
        <LayersIcon
          aria-hidden="true"
          className="text-muted-foreground size-3"
        />
        <span className="font-mono text-[11px] font-medium">{flagKey}</span>
      </span>
      <span className="text-muted-foreground mt-0.5 text-[10px]">{meta}</span>
      {chip ? (
        <span className="text-ok-ink mt-1 inline-flex items-center gap-1 text-[10px]">
          <span aria-hidden="true" className="bg-ok-ink size-1.5 rounded-full" />
          {chip}
        </span>
      ) : null}
    </div>
  );
}

function GraphLabel({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground text-center text-[10px] tracking-[0.14em] uppercase">
      {children}
    </p>
  );
}

function Connector() {
  return (
    <span
      aria-hidden="true"
      className="border-border mx-auto h-5 w-px border-l"
    />
  );
}

const legend = [
  { label: "Upstream", tone: "upstream" as const },
  { label: "This flag", tone: "self" as const },
  { label: "Downstream", tone: "downstream" as const },
];

/**
 * Dependencies tab.
 *
 * Read-only, so it stays a Server Component. The graph is laid out with flex
 * and border rules rather than a graph library: the diagram is a static
 * three-tier tree, and a dependency would not be justified.
 */
export function FlagDependencies({
  graph,
  flagKey,
  status,
}: {
  readonly graph: FlagDependencyGraph;
  readonly flagKey: string;
  /** The flag's own status; the graph is project-wide, not per environment. */
  readonly status: FlagStatus;
}) {
  const hasAny = graph.upstream.length > 0 || graph.downstream.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.72fr)]">
      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-medium">Dependency Graph</h2>
              <p className="text-muted-foreground mt-1 text-[11px]">
                {flagKey} · project-wide
              </p>
            </div>

            <ul className="flex items-center gap-3">
              {legend.map((item) => (
                <li
                  key={item.label}
                  className="text-muted-foreground flex items-center gap-1.5 text-[10px]"
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      "size-1.5 rounded-full",
                      item.tone === "upstream" && "bg-slate-ink",
                      item.tone === "self" && "bg-primary",
                      item.tone === "downstream" && "bg-purple-ink",
                    )}
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          </div>

          {hasAny ? (
            <div className="mt-5">
              {graph.upstream.length > 0 ? (
                <>
                  <GraphLabel>requires {graph.upstream.length}</GraphLabel>
                  <ul className="mt-3 flex flex-wrap justify-center gap-3">
                    {graph.upstream.map((dependency) => (
                      <li key={dependency}>
                        <GraphNode
                          flagKey={dependency}
                          meta="Upstream dependency"
                          tone="upstream"
                        />
                      </li>
                    ))}
                  </ul>
                  <div className="mt-1">
                    <Connector />
                  </div>
                </>
              ) : null}

              <div className="flex justify-center">
                <GraphNode
                  flagKey={flagKey}
                  meta="This flag"
                  tone="self"
                  chip={status === "archived" ? "Archived" : "Active"}
                />
              </div>

              {graph.downstream.length > 0 ? (
                <>
                  <div className="mt-1">
                    <Connector />
                  </div>
                  <GraphLabel>
                    required by {graph.downstream.length}
                  </GraphLabel>
                  <ul className="mt-3 flex flex-wrap justify-center gap-3">
                    {graph.downstream.map((dependency) => (
                      <li key={dependency}>
                        <GraphNode
                          flagKey={dependency}
                          meta="Downstream dependency"
                          tone="downstream"
                        />
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-muted-foreground mt-4 rounded-lg border border-dashed p-4 text-[12px]">
              This flag has no dependencies in either direction.
            </p>
          )}
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Dependency Rules</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            What each relationship requires at evaluation time.
          </p>

          {hasAny ? (
            <ul className="mt-3 divide-y">
              {graph.upstream.map((dependency) => (
                <li
                  key={dependency}
                  className="flex items-start gap-3 py-3 first:pt-0"
                >
                  <CheckCircle2Icon
                    aria-hidden="true"
                    className="text-ok-ink mt-0.5 size-3.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px]">{dependency}</p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      Evaluated before {flagKey}.
                    </p>
                  </div>
                  <span className="bg-ok-ink/10 text-ok-ink shrink-0 rounded-md px-2 py-0.5 text-[10px]">
                    upstream
                  </span>
                </li>
              ))}

              {graph.downstream.map((dependency) => (
                <li
                  key={dependency}
                  className="flex items-start gap-3 py-3 last:pb-0"
                >
                  <GitBranchIcon
                    aria-hidden="true"
                    className="text-warn-ink mt-0.5 size-3.5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-[12px]">{dependency}</p>
                    <p className="text-muted-foreground mt-0.5 text-[11px]">
                      Evaluated after {flagKey}.
                    </p>
                  </div>
                  <span className="bg-warn-ink/10 text-warn-ink shrink-0 rounded-md px-2 py-0.5 text-[10px]">
                    downstream
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-[12px]">
              No dependency rules to evaluate.
            </p>
          )}
        </section>
      </div>

      <div className="space-y-4">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Dependency Summary</h2>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            {[
              ["Upstream", graph.summary.upstream],
              ["Downstream", graph.summary.downstream],
              ["Circular", graph.summary.circular ? "Yes" : "No"],
              ["Max depth", graph.summary.maxDepth],
            ].map(([label, value]) => (
              <div key={label} className="bg-muted/50 rounded-lg border p-3">
                <dt className="text-muted-foreground text-[11px]">{label}</dt>
                <dd className="mt-1 text-xl font-semibold tracking-tight">
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          {graph.summary.circular ? (
            <p className="text-danger-ink mt-3 text-[11px]">
              Circular dependencies detected.
            </p>
          ) : (
            <p className="text-ok-ink mt-3 inline-flex items-center gap-1.5 text-[11px]">
              <CheckCircle2Icon aria-hidden="true" className="size-3.5" />
              No circular dependencies
            </p>
          )}
        </section>

        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Evaluation Order</h2>
          <p className="text-muted-foreground mt-1 text-[11px]">
            Flags are resolved top to bottom before {flagKey} is evaluated.
          </p>

          {graph.evaluationOrder.length === 0 ? (
            <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-4 text-[12px]">
              No evaluation order recorded.
            </p>
          ) : (
            <ol className="mt-3 divide-y">
              {graph.evaluationOrder.map((entry, index) => (
                <li
                  key={entry.key}
                  className="flex items-center gap-3 py-2 first:pt-0 last:pb-0"
                >
                  <span className="text-muted-foreground w-4 text-right text-[11px]">
                    {index + 1}
                  </span>
                  <span
                    className={cn(
                      "flex-1 font-mono text-[12px]",
                      entry.isSelf && "font-medium",
                    )}
                  >
                    {entry.key}
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 text-[10px] capitalize",
                      entry.isSelf ? "text-primary" : "text-ok-ink",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 rounded-full",
                        entry.isSelf ? "bg-primary" : "bg-ok-ink",
                      )}
                    />
                    {entry.isSelf ? "This flag" : entry.status}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
