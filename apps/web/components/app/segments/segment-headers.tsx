import Link from "next/link";
import {
  ChevronLeftIcon,
  MoreHorizontalIcon,
  UsersRoundIcon,
} from "lucide-react";
import { EditResourceDialog } from "@/components/app/edit-resource-dialog";
import { cn } from "cn";
import { SegmentGlyph } from "@/components/app/segments/segment-glyph";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface CreateSegmentHeaderProps {
  readonly steps: string[];
  /** Zero-based index of the step currently in view. */
  readonly currentStep: number;
}

/** Step indicator for the create segment form. */
export function CreateSegmentHeader({
  steps,
  currentStep,
}: CreateSegmentHeaderProps) {
  return (
    <div className="bg-card mb-4 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <span className="bg-primary-ink/10 text-primary-ink flex size-9 shrink-0 items-center justify-center rounded-lg">
          <UsersRoundIcon aria-hidden="true" className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">
            Create segment
          </h1>
          <p className="text-muted-foreground mt-0.5 text-[13px]">
            Define a reusable group of users that flags can target.
          </p>
        </div>

        <ol className="hidden shrink-0 items-center gap-1 sm:flex">
          {steps.map((step, index) => (
            <li key={step} className="flex items-center gap-1">
              {index > 0 ? (
                <span
                  aria-hidden="true"
                  className="text-muted-foreground px-1 text-xs"
                >
                  ·
                </span>
              ) : null}
              <span
                aria-current={index === currentStep ? "step" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-medium",
                  index === currentStep
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground",
                )}
              >
                {step}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

interface SegmentDetailHeaderProps {
  readonly projectKey: string;
  readonly segmentKey: string;
  readonly name: string;
  readonly description: string | null;
  readonly archived: boolean;
}

/** Identity and status strip above the segment detail tabs. */
export function SegmentDetailHeader({
  projectKey,
  segmentKey,
  name,
  description,
  archived,
}: SegmentDetailHeaderProps) {
  return (
    <div className="bg-card mb-4 rounded-lg border p-4">
      <Link
        href="/segments"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px] transition-colors"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
        Segments
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <SegmentGlyph segmentKey={segmentKey} className="size-9" />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold tracking-tight">{name}</h1>
            <Badge variant="secondary">Dynamic</Badge>
          </div>
          {description ? (
            <p className="text-muted-foreground mt-0.5 text-[13px]">
              {description}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px]",
              archived
                ? "bg-muted text-muted-foreground"
                : "bg-ok-ink/10 text-ok-ink",
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                archived ? "bg-muted-foreground" : "bg-ok-ink",
              )}
            />
            {archived ? "Archived" : "Active"}
          </span>
          <EditResourceDialog kind="segment" projectKey={projectKey} resourceKey={segmentKey} name={name} description={description} />
          <Button
            variant="outline"
            size="icon-sm"
            disabled
            title="More actions — coming soon"
            aria-label="More segment actions"
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
