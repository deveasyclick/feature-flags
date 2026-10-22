import { Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Destructive workspace action.
 *
 * Uses the same danger treatment as the segment archive card. The button is
 * disabled with a title rather than pretending to delete anything — deleting a
 * workspace is not something this app can undo yet.
 */
export function SettingsDanger() {
  return (
    <section className="border-danger-ink/30 bg-danger-ink/5 rounded-lg border p-4">
      <h2 className="text-danger-ink text-[13px] font-medium">
        Delete workspace
      </h2>

      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <p className="text-muted-foreground text-[11px]">
          Workspace deletion is not available yet.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled
          title="Deleting a workspace — coming soon"
          className="border-danger-ink/40 text-danger-ink shrink-0 gap-1.5 text-[11px]"
        >
          <Trash2Icon aria-hidden="true" className="size-3.5" />
          Delete workspace
        </Button>
      </div>
    </section>
  );
}
