import { cache } from "react";
import type { Project } from "@iwifunni/contracts";
import { findProject } from "@/lib/scope";

/**
 * Resolve one project for the project-scoped routes.
 *
 * Cached per request, because the layout, the page and its metadata all resolve
 * the same key. A key that does not exist comes back as `null` — see
 * `findProject` — and the caller decides the route is missing.
 */
export const loadProject = cache(
  (key: string): Promise<Project | null> => findProject(key),
);
