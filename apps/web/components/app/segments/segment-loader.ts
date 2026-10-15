import { cache } from "react";

import type { SegmentDetail, SegmentFlag } from "@iwifunni/contracts";

import { ApiError, segments } from "@/lib/api";

/**
 * A missing segment is `null` rather than a thrown 404, so pages can call
 * `notFound()`; any other failure propagates to the error boundary.
 */
export const loadSegment = cache(
  async (
    projectKey: string,
    segmentKey: string,
  ): Promise<SegmentDetail | null> => {
    try {
      return await segments.get(projectKey, segmentKey);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
);

export const loadSegmentFlags = cache(
  (projectKey: string, segmentKey: string): Promise<SegmentFlag[]> =>
    segments.flags(projectKey, segmentKey),
);
