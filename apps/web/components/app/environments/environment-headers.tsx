import Link from "next/link";
import { ChevronLeftIcon, PencilIcon, ServerIcon } from "lucide-react";
import { cn } from "cn";
import type { EnvironmentDetail } from "@iwifunni/contracts";
import { EnvironmentBadges } from "@/components/app/environments/environment-cards";
import { environmentColorTone } from "@/components/app/environments/environment-colors";
import { EnvironmentMenu } from "@/components/app/environments/environment-menu";
import { Button } from "@/components/ui/button";
import { resolveEnvironmentColor } from "@/lib/environment-color";

/**
 * Headers for the environment screens.
 *
 * Both are Server Components: the only interactive piece is the actions menu,
 * which is imported as a Client Component.
 */

interface CreateEnvironmentHeaderProps {
  /** Steps shown as a progress path, e.g. ["Details", "Flags", "Review"]. */
  readonly steps: string[];
  /** Zero-based index of the step currently in view. */
  readonly currentStep: number;
}

/** Title block and step path of the create screen. */
export function CreateEnvironmentHeader({
  steps,
  currentStep,
}: CreateEnvironmentHeaderProps) {
  return (
    <div className="mb-4">
      <Link
        href="/environments"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px] transition-colors"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
        Environments
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">
            Create environment
          </h1>
          <p className="text-muted-foreground mt-1 text-[13px]">
            Add an isolated environment for testing and staged rollouts.
          </p>
        </div>

        <ol className="flex shrink-0 items-center gap-3">
          {steps.map((step, index) => {
            const current = index === currentStep;

            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4.5 items-center justify-center rounded-full text-[10px] font-medium",
                    current
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span
                  aria-current={current ? "step" : undefined}
                  className={cn(
                    "text-[11px] font-medium",
                    current ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {step}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

/** Identity strip shown above the tabs on every environment detail screen. */
export function EnvironmentDetailHeader({
  environment,
}: {
  readonly environment: EnvironmentDetail;
}) {
  return (
    <div className="bg-card mb-4 rounded-lg border p-4">
      <Link
        href="/environments"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px] transition-colors"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
        Environments
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            environmentColorTone[resolveEnvironmentColor(environment.color)],
          )}
        >
          <ServerIcon aria-hidden="true" className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {environment.name}
            </h1>
            <EnvironmentBadges
              isDefault={environment.isDefault}
              isProtected={environment.isProtected}
              isArchived={environment.archivedAt !== null}
            />
          </div>
          <p className="text-muted-foreground mt-0.5 font-mono text-[12px]">
            {environment.key}
          </p>
          {environment.description ? (
            <p className="text-muted-foreground mt-1 max-w-2xl text-[12px]">
              {environment.description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <Button asChild variant="outline" size="sm" className="gap-1.5 text-[11px]">
            <Link href={`/environments/${environment.key}/settings`}>
              <PencilIcon aria-hidden="true" className="size-3.5" />
              Edit environment
            </Link>
          </Button>

          <EnvironmentMenu environment={environment} />
        </div>
      </div>
    </div>
  );
}
