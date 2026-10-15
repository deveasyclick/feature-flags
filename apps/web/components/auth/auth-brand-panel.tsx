import { CheckIcon } from "lucide-react";
import { Logo } from "@/components/logo";

const highlights = [
  "Progressive rollouts and instant kill switches",
  "Audit-ready history for every flag change",
  "SDKs for every language and runtime",
] as const;

/** Compliance badges shown next to the copyright in the panel footer. */
const complianceBadges = ["SOC 2", "GDPR"] as const;

export type AuthPanelVariant = "product" | "getting-started";

interface PanelCopy {
  eyebrow: string;
  heading: string;
  body: string;
}

const panelCopy: Record<AuthPanelVariant, PanelCopy> = {
  product: {
    eyebrow: "Feature management",
    heading: "Ship features with confidence.",
    body: "Give your team fine-grained control over every release — no redeploys, no guesswork.",
  },
  "getting-started": {
    eyebrow: "Getting started",
    heading: "Welcome to Iwifunni.",
    body: "Let's set up your first project — one project, one environment, and you're ready to ship.",
  },
};

interface AuthBrandPanelProps {
  /**
   * Which copy the panel shows. The last onboarding step welcomes the user to
   * the product instead of pitching it; every other screen keeps the pitch.
   */
  readonly variant?: AuthPanelVariant;
}

/**
 * The branding panel shown alongside every authentication form.
 *
 * Hidden below `lg` so that small screens show only the form. Colours come from
 * the auth token group, so the panel follows the theme rather than hard-coding
 * a single light appearance.
 */
export function AuthBrandPanel({ variant = "product" }: AuthBrandPanelProps) {
  const { eyebrow, heading, body } = panelCopy[variant];

  return (
    <aside className="bg-auth-panel border-auth-panel-border hidden flex-col justify-between border-r p-10 lg:flex">
      <div className="flex items-center gap-2">
        <span className="bg-auth-glyph-bg text-auth-accent flex size-8 items-center justify-center rounded-lg">
          <Logo className="size-4" />
        </span>
        <span className="text-auth-heading text-[13px] font-semibold tracking-[0.2em] uppercase">
          Iwifunni
        </span>
      </div>

      <div>
        <p className="text-auth-accent font-mono text-[11px] font-medium tracking-[0.18em] uppercase">
          {eyebrow}
        </p>
        <p className="text-auth-heading mt-3 max-w-xs text-3xl leading-tight font-semibold tracking-tight">
          {heading}
        </p>
        <p className="text-auth-body mt-4 max-w-sm text-sm leading-6">{body}</p>
        <ul className="mt-8 space-y-3">
          {highlights.map((highlight) => (
            <li
              key={highlight}
              className="text-auth-body flex items-start gap-2.5 text-sm leading-6"
            >
              <span className="bg-auth-accent/10 mt-1 flex size-4 shrink-0 items-center justify-center rounded-full">
                <CheckIcon
                  aria-hidden="true"
                  className="text-auth-accent size-2.5"
                />
              </span>
              <span>{highlight}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="text-auth-muted flex items-center justify-between text-xs">
        <p>&copy; 2026 Iwifunni, Inc.</p>
        <div className="flex items-center gap-2">
          {complianceBadges.map((badge) => (
            <span
              key={badge}
              className="bg-auth-badge border-auth-badge-border text-auth-accent rounded-full border px-2.5 py-1 text-[10px] font-medium"
            >
              {badge}
            </span>
          ))}
        </div>
      </div>
    </aside>
  );
}
