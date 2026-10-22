import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SegmentDetailHeader } from "@/components/app/segments/segment-headers";
import { loadSegment } from "@/components/app/segments/segment-loader";
import { SegmentMembers } from "@/components/app/segments/segment-panels";
import { SegmentTabs } from "@/components/app/segments/segment-tabs";
import { getScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/segments/[key]/members">,
): Promise<Metadata> {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return { title: "Segment not found" };

  const segment = await loadSegment(project.key, key);

  return {
    title: segment ? `${segment.name} · Members` : "Segment not found",
    description: `Members of ${key}.`,
  };
}

export default async function SegmentMembersPage(
  props: PageProps<"/segments/[key]/members">,
) {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return null;

  const segment = await loadSegment(project.key, key);
  if (!segment) notFound();

  return (
    <>
      <SegmentDetailHeader
        projectKey={project.key}
        segmentKey={segment.key}
        name={segment.name}
        description={segment.description}
        archived={segment.archivedAt !== null}
      />
      <SegmentTabs segmentKey={segment.key} />
      <SegmentMembers conditions={segment.conditions} />
    </>
  );
}
