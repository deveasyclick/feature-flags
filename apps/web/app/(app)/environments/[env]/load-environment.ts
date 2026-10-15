import { cache } from "react";
import type { EnvironmentDetail } from "@iwifunni/contracts";
import * as api from "@/lib/api";

/**
 * Resolve one environment inside a project.
 *
 * A key that belongs to another project, or that no longer exists, answers 404;
 * this maps that to `null` so the page decides the route is missing. Cached per
 * request, because the page and its metadata both resolve the same environment.
 */
export const findEnvironment = cache(
  async (
    projectKey: string,
    environmentKey: string,
  ): Promise<EnvironmentDetail | null> => {
    try {
      return await api.environments.get(projectKey, environmentKey);
    } catch (error) {
      if (error instanceof api.ApiError && error.status === 404) return null;
      throw error;
    }
  },
);
