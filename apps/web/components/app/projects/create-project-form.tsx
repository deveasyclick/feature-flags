"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LoaderCircleIcon, PlusIcon } from "lucide-react";
import { STARTER_ENVIRONMENTS } from "@iwifunni/contracts";
import { cn } from "cn";
import {
  environmentColors,
  environmentColorSwatch,
} from "@/components/app/environments/environment-colors";
import { ProjectWhatYouGetCard } from "@/components/app/projects/project-what-you-get";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import type { EnvironmentColor } from "@/lib/environment-color";
import * as api from "@/lib/api";
import { selectProject } from "@/lib/scope-actions";
import { capture } from "@/shared/analytics";
import { isRequired } from "@/lib/validation";

const starterEnvironmentNames = STARTER_ENVIRONMENTS.map(({ name }) => name);

interface CreateProjectErrors {
  form?: string;
  name?: string;
}

export function CreateProjectForm() {
  const [name, setName] = useState("");
  const [color, setColor] = useState<EnvironmentColor>("primary");
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [errors, setErrors] = useState<CreateProjectErrors>({});
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const router = useRouter();

  function clearError(field: keyof CreateProjectErrors) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nameError = isRequired(name, "Project name");
    if (nameError) {
      setErrors({ name: nameError });
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const project = await api.projects.create(
        { name: name.trim() },
        { signal: controller.signal },
      );

      await selectProject(project.key);

      capture("project_created", {
        starter_environment_count: STARTER_ENVIRONMENTS.length,
      });

      router.refresh();
      router.push(`/projects/${project.key}`);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      setErrors({
        form:
          error instanceof api.ApiError
            ? error.message
            : "Something went wrong. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.42fr)]">
        <section className="bg-card rounded-lg border p-4">
          <h2 className="text-[13px] font-medium">Project details</h2>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_auto]">
            <Field
              id="create-project-name"
              label="Name"
              name="name"
              autoComplete="off"
              placeholder="Checkout Platform"
              required
              value={name}
              error={errors.name}
              onChange={(event) => {
                setName(event.target.value);
                clearError("name");
              }}
            />

            <div className="space-y-2">
              <Label asChild>
                <p id="create-project-color-label">Color</p>
              </Label>
              <RadioGroup
                value={color}
                onValueChange={(value) => setColor(value as EnvironmentColor)}
                aria-labelledby="create-project-color-label"
                className="flex h-8 items-center gap-2.5"
              >
                {environmentColors.map((option) => (
                  <RadioGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={`${option.label} color`}
                    title={option.label}
                    className={cn(
                      "size-5 data-checked:ring-2 data-checked:ring-foreground/40 data-checked:ring-offset-2",
                      environmentColorSwatch[option.value],
                    )}
                  />
                ))}
              </RadioGroup>
            </div>
          </div>

          <p className="text-muted-foreground mt-2 text-[11px] leading-5">
            The project key is derived from the name. The colour is not stored by
            the create call yet.
          </p>

          <h3 className="mt-6 text-[13px] font-medium">Environments</h3>

          <p className="text-muted-foreground mt-2 text-[11px] leading-5">
            Every project starts with {starterEnvironmentNames[0]}, which is its
            default, and {starterEnvironmentNames.slice(1).join(", ")}. Neither
            is protected, so changes to them publish directly. Add staging or
            any other environment later from the environment switcher.
          </p>

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <div className="mt-6 flex items-center justify-end gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/projects">Cancel</Link>
            </Button>
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
              {pending ? "Creating project…" : "Create project"}
            </Button>
          </div>
        </section>

        <div className="space-y-3">
          <ProjectWhatYouGetCard />

          <section className="border-info-ink/20 bg-info-ink/5 rounded-lg border p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-info-ink text-[12px] font-medium">
                  Set as default project
                </h2>
                <p className="text-muted-foreground mt-1 text-[11px] leading-5">
                  New members land in this project. Not applied yet — the API
                  does not model a workspace default project.
                </p>
              </div>
              <Switch
                checked={setAsDefault}
                onCheckedChange={setSetAsDefault}
                aria-label="Set as default project"
              />
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}
