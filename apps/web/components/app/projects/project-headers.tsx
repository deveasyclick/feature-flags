import Link from "next/link";
import { ChevronLeftIcon } from "lucide-react";
import { cn } from "cn";
import type { Project } from "@iwifunni/contracts";
import { environmentColorTone } from "@/components/app/environments/environment-colors";
import { projectGlyphs } from "@/components/app/projects/project-glyphs";
import { ProjectMenu } from "@/components/app/projects/project-menu";
import { Badge } from "@/components/ui/badge";
import { EditResourceDialog } from "@/components/app/edit-resource-dialog";
import { resolveEnvironmentColor } from "@/lib/environment-color";

/**
 * Identity strip shown above the tabs on every project screen.
 *
 * A Server Component: the only interactive piece is the actions menu, which is
 * imported as a Client Component.
 */
export function ProjectHeader({ project }: { readonly project: Project }) {
  const Glyph = projectGlyphs[resolveEnvironmentColor(project.color)];

  return (
    <div className="bg-card mb-4 rounded-lg border p-4">
      <Link
        href="/projects"
        className="text-muted-foreground hover:text-foreground mb-3 inline-flex items-center gap-1 text-[12px] transition-colors"
      >
        <ChevronLeftIcon aria-hidden="true" className="size-3.5" />
        Back to projects
      </Link>

      <div className="flex flex-wrap items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            environmentColorTone[resolveEnvironmentColor(project.color)],
          )}
        >
          <Glyph aria-hidden="true" className="size-4.5" />
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {project.name}
            </h1>
            {project.ownerTeam ? (
              <Badge variant="secondary" className="text-[10px]">
                {project.ownerTeam}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 text-[12px]">
            {project.description ??
              `${project.environmentCount} environments · ${project.key}`}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <EditResourceDialog kind="project" projectKey={project.key} resourceKey={project.key} name={project.name} description={project.description} />

          <ProjectMenu name={project.name} />
        </div>
      </div>
    </div>
  );
}
