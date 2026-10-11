import Link from "next/link";
import { cn } from "cn";

export const FLAG_TABS = [
  { value: "configuration", label: "Configuration" },
  { value: "variations", label: "Variations" },
  { value: "targeting", label: "Targeting" },
  { value: "preview", label: "Preview" },
  { value: "history", label: "History" },
  { value: "dependencies", label: "Dependencies" },
] as const;

export type FlagTab = (typeof FLAG_TABS)[number]["value"];

export const DEFAULT_FLAG_TAB: FlagTab = "configuration";

/** The tab a `?tab=` value names, or the default when it names nothing valid. */
export function toFlagTab(value: string | string[] | undefined): FlagTab {
  const candidate = Array.isArray(value) ? value[0] : value;

  return (
    FLAG_TABS.find((tab) => tab.value === candidate)?.value ?? DEFAULT_FLAG_TAB
  );
}

/**
 * One flag page, addressed by the tab in `?tab=`.
 *
 * The environment is carried along in every link so switching tabs never
 * silently changes which environment's configuration is on screen.
 */
export function flagTabHref(
  projectKey: string,
  flagKey: string,
  environmentKey: string,
  tab: FlagTab,
): string {
  const base = `/projects/${projectKey}/flags/${flagKey}`;
  const environment = `environment=${encodeURIComponent(environmentKey)}`;

  return tab === DEFAULT_FLAG_TAB
    ? `${base}?${environment}`
    : `${base}?${environment}&tab=${tab}`;
}

/**
 * Tab bar for the flag detail page.
 *
 * Rendered as links rather than tabs with local state so each tab is a real,
 * addressable URL that can be opened directly or bookmarked.
 */
export function FlagTabs({
  projectKey,
  flagKey,
  environmentKey,
  active,
}: {
  readonly projectKey: string;
  readonly flagKey: string;
  readonly environmentKey: string;
  readonly active: FlagTab;
}) {
  return (
    <nav aria-label="Flag sections" className="mb-4 flex gap-1 border-b">
      {FLAG_TABS.map((tab) => {
        const current = tab.value === active;

        return (
          <Link
            key={tab.value}
            href={flagTabHref(projectKey, flagKey, environmentKey, tab.value)}
            aria-current={current ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-[12px] transition-colors",
              current
                ? "border-primary text-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
