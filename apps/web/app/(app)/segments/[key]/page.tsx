import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SegmentArchive } from "@/components/app/segments/segment-archive";
import { SegmentConditionEditor } from "@/components/app/segments/segment-condition-editor";
import { SegmentDetailHeader } from "@/components/app/segments/segment-headers";
import {
  loadSegment,
  loadSegmentFlags,
} from "@/components/app/segments/segment-loader";
import {
  SegmentRuleTable,
  SegmentUsedByFlags,
} from "@/components/app/segments/segment-panels";
import { SegmentLivePreview } from "@/components/app/segments/segment-preview";
import { SegmentSummaryCard } from "@/components/app/segments/segment-summary";
import { SegmentTabs } from "@/components/app/segments/segment-tabs";
import { getScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/segments/[key]">,
): Promise<Metadata> {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return { title: "Segment not found" };

  const segment = await loadSegment(project.key, key);

  return {
    title: segment ? `${segment.name} · Segments` : "Segment not found",
    description: segment?.description ?? undefined,
  };
}

/** Definition tab — the default view for a segment. */
export default async function SegmentDefinitionPage(
  props: PageProps<"/segments/[key]">,
) {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return null;

  const segment = await loadSegment(project.key, key);
  if (!segment) notFound();

  const flags = await loadSegmentFlags(project.key, segment.key);
  const archived = segment.archivedAt !== null;

  return (
    <>
      <SegmentDetailHeader
        projectKey={project.key}
        segmentKey={segment.key}
        name={segment.name}
        description={segment.description}
        archived={archived}
      />
      <SegmentTabs segmentKey={segment.key} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.62fr)]">
        <div className="space-y-4">
          <SegmentRuleTable conditions={segment.conditions} />
          <SegmentConditionEditor key={segment.updatedAt} projectKey={project.key} segmentKey={segment.key} conditions={segment.conditions} archived={archived} />
          <SegmentUsedByFlags flags={flags} />
        </div>

        <div className="space-y-4">
          <SegmentSummaryCard
            conditions={segment.conditions}
            flags={flags}
            updatedAt={segment.updatedAt}
            now={new Date()}
          />
          <SegmentLivePreview conditions={segment.conditions} />
          <SegmentArchive
            projectKey={project.key}
            segmentKey={segment.key}
            archived={archived}
          />
        </div>
      </div>
    </>
  );
}
