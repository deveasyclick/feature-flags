import type { FlagStatus } from "@iwifunni/contracts";
import { Badge } from "@/components/ui/badge";

export type FlagState =
  | { kind: "on" }
  | { kind: "off" }
  | { kind: "percentage"; percentage: number };

/** How one flag resolves in one environment, from that environment's summary. */
export function flagState(state: {
  enabled: boolean;
  rolloutPercentage: number;
}): FlagState {
  if (!state.enabled || state.rolloutPercentage <= 0) return { kind: "off" };
  if (state.rolloutPercentage >= 100) return { kind: "on" };

  return { kind: "percentage", percentage: state.rolloutPercentage };
}

/**
 * The flag's own status, which is project-wide and independent of any
 * environment: archiving a flag retires it everywhere, while an environment can
 * still serve it or not on its own.
 */
export function FlagStatusBadge({ status }: { readonly status: FlagStatus }) {
  return status === "archived" ? (
    <Badge
      variant="destructive"
      title="Project-wide lifecycle status: an archived flag serves its off variation in every environment."
    >
      Archived
    </Badge>
  ) : (
    <Badge
      variant="ok"
      title="Project-wide lifecycle status; each environment still decides whether it serves the flag."
    >
      Active
    </Badge>
  );
}

/**
 * Effective state of one flag in one environment.
 *
 * Kept in its own module so a Client Component can render it without pulling a
 * whole flag screen into the browser bundle.
 */
export function FlagStatePill({
  state,
  label = "short",
}: {
  readonly state: FlagState;
  /**
   * `short` (the default) suits dense tables — `ON` / `OFF`. `long` spells the
   * state out (`Enabled` / `Disabled`) where there is room for it.
   */
  readonly label?: "short" | "long";
}) {
  if (state.kind === "on") {
    return (
      <Badge variant="ok" className="gap-1.5">
        <span aria-hidden="true" className="bg-ok-ink size-1.5 rounded-full" />
        {label === "long" ? "Enabled" : "ON"}
      </Badge>
    );
  }

  if (state.kind === "percentage") {
    return (
      <Badge variant="secondary" className="bg-info-ink/10 text-info-ink gap-1.5">
        <span aria-hidden="true" className="bg-info-ink size-1.5 rounded-full" />
        {state.percentage}%
      </Badge>
    );
  }

  return (
    <Badge variant="secondary" className="gap-1.5">
      <span
        aria-hidden="true"
        className="bg-muted-foreground size-1.5 rounded-full"
      />
      {label === "long" ? "Disabled" : "OFF"}
    </Badge>
  );
}
