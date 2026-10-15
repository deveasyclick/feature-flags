import { FlaskConicalIcon, UserCheckIcon } from "lucide-react";
import type { TargetingCondition } from "@iwifunni/contracts";
import {
  countMatchingSampleUsers,
  matchedAttributes,
  matchingSampleUsers,
  sampleAudience,
  type SampleUser,
} from "@/components/app/segments/segment-sample";

const PREVIEW_LIMIT = 3;

function MatchChip() {
  return (
    <span className="bg-ok-ink/10 text-ok-ink inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px]">
      <span aria-hidden="true" className="bg-ok-ink size-1.5 rounded-full" />
      matched
    </span>
  );
}

function PreviewRow({
  user,
  conditions,
}: {
  readonly user: SampleUser;
  readonly conditions: TargetingCondition[];
}) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-start gap-2">
        <span className="bg-muted text-muted-foreground mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full">
          <UserCheckIcon aria-hidden="true" className="size-3" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-mono text-[11px]">{user.id}</p>
          <p className="text-muted-foreground truncate font-mono text-[10px]">
            {matchedAttributes(conditions, user).join(" · ")}
          </p>
        </div>
      </div>
      <MatchChip />
    </li>
  );
}

/**
 * Definition tab — the segment's conditions evaluated against the sample
 * audience. Deliberately not called live: no membership data exists to show.
 */
export function SegmentLivePreview({
  conditions,
}: {
  readonly conditions: TargetingCondition[];
}) {
  const members = matchingSampleUsers(conditions, PREVIEW_LIMIT);
  const matched = countMatchingSampleUsers(conditions);

  return (
    <section className="bg-card rounded-lg border p-4">
      <h2 className="text-[13px] font-medium">Sample estimate</h2>
      <p className="text-muted-foreground mt-1 text-[11px]">
        These conditions evaluated locally against a fixed sample audience.
      </p>

      {members.length === 0 ? (
        <p className="text-muted-foreground mt-3 rounded-lg border border-dashed p-3 text-[12px]">
          No sample users match these conditions.
        </p>
      ) : (
        <ul className="mt-3 divide-y">
          {members.map((user) => (
            <PreviewRow key={user.id} user={user} conditions={conditions} />
          ))}
        </ul>
      )}

      <p className="text-muted-foreground mt-3 flex items-center gap-1.5 border-t pt-3 text-[10px]">
        <FlaskConicalIcon aria-hidden="true" className="size-3" />
        {matched} of {sampleAudience.length} sample users match. Not live member
        data.
      </p>
    </section>
  );
}
