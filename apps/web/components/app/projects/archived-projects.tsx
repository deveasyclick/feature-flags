import { projects } from "@/lib/api";
import { ProjectLifecycle } from "./project-lifecycle";

export async function ArchivedProjects() {
  const rows = (await projects.list({ includeArchived: true })).filter((project) => project.archivedAt);
  if (!rows.length) return null;
  return <section className="mt-4 space-y-3"><h2 className="text-sm font-medium">Archived projects</h2>{rows.map((project) => <ProjectLifecycle key={project.id} projectKey={project.key} name={project.name} archived />)}</section>;
}
