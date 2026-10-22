import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SegmentDetailHeader } from "@/components/app/segments/segment-headers";
import {
  loadSegment,
  loadSegmentFlags,
} from "@/components/app/segments/segment-loader";
import { SegmentFlags } from "@/components/app/segments/segment-panels";
import { SegmentTabs } from "@/components/app/segments/segment-tabs";
import { getScope } from "@/lib/scope";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/segments/[key]/flags">,
): Promise<Metadata> {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return { title: "Segment not found" };

  const segment = await loadSegment(project.key, key);

  return {
    title: segment ? `${segment.name} · Flags` : "Segment not found",
    description: `Flags referencing ${key}.`,
  };
}

export default async function SegmentFlagsPage(
  props: PageProps<"/segments/[key]/flags">,
) {
  const { key } = await props.params;
  const { project } = await getScope();
  if (!project) return null;

  const segment = await loadSegment(project.key, key);
  if (!segment) notFound();

  const flags = await loadSegmentFlags(project.key, segment.key);

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
      <SegmentFlags flags={flags} />
    </>
  );
}
