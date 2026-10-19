"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { OnboardingSteps } from "@/components/auth/onboarding-steps";
import { Field, FieldError, PrefixedField } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { AuthError, createWorkspace } from "@/lib/auth";
import { capture } from "@/shared/analytics";
import { workspaceHost } from "@/components/app/settings/settings-options";
import {
  isRequired,
  isValidOptionalEmailList,
  isValidWorkspaceSlug,
  toWorkspaceSlug,
} from "@/lib/validation";

interface CreateWorkspaceErrors {
  form?: string;
  name?: string;
  slug?: string;
  invites?: string;
}

export function CreateWorkspaceForm() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [invites, setInvites] = useState("");
  const [editedSlug, setEditedSlug] = useState(false);
  const [errors, setErrors] = useState<CreateWorkspaceErrors>({});
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);

  function clearError(field: keyof CreateWorkspaceErrors) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  function handleNameChange(value: string) {
    setName(value);
    // Keep the slug in step with the name until the user takes it over.
    if (!editedSlug) setSlug(toWorkspaceSlug(value));
    clearError("name");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors: CreateWorkspaceErrors = {
      name: isRequired(name, "Workspace name") ?? undefined,
      slug: isValidWorkspaceSlug(slug) ?? undefined,
      invites: isValidOptionalEmailList(invites) ?? undefined,
    };

    if (nextErrors.name || nextErrors.slug || nextErrors.invites) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setPending(true);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await createWorkspace(
        {
          name: name.trim(),
          slug: slug.trim(),
          invites: invites
            .split(",")
            .map((invite) => invite.trim())
            .filter(Boolean),
        },
        controller.signal,
      );

      capture("workspace_created", {
        invited_teammate_count: invites
          .split(",")
          .map((invite) => invite.trim())
          .filter(Boolean).length,
      });

      router.refresh();
      router.push("/create-project");
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      if (error instanceof AuthError) {
        setErrors((previous) => ({
          ...previous,
          ...(error.fieldErrors as CreateWorkspaceErrors),
        }));
        return;
      }

      setErrors({ form: "Something went wrong. Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <AuthCard
      steps={<OnboardingSteps current="workspace" />}
      title="Create your workspace"
      description="Workspaces group your flags, environments, and teammates."
    >
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field
          id="create-workspace-name"
          label="Workspace name"
          name="name"
          autoComplete="organization"
          placeholder="Acme Inc."
          required
          value={name}
          error={errors.name}
          onChange={(event) => handleNameChange(event.target.value)}
        />

        <PrefixedField
          id="create-workspace-url"
          label="Workspace URL"
          name="slug"
          prefix={`${workspaceHost}/`}
          placeholder="acme"
          required
          value={slug}
          error={errors.slug}
          hint="This becomes your dashboard URL. You can change it later."
          onChange={(event) => {
            setEditedSlug(true);
            setSlug(event.target.value);
            clearError("slug");
          }}
        />

        <Field
          id="create-workspace-invites"
          label="Invite teammates (optional)"
          name="invites"
          type="email"
          multiple
          autoComplete="off"
          placeholder="sarah@acme.io, daniel@acme.io"
          value={invites}
          error={errors.invites}
          hint="Separate multiple emails with commas. They'll join as Engineers."
          onChange={(event) => {
            setInvites(event.target.value);
            clearError("invites");
          }}
        />

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {pending ? "Creating workspace…" : "Create workspace"}
          {pending ? null : (
            <ArrowRightIcon aria-hidden="true" className="size-3.5" />
          )}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-xs leading-5">
        You can invite more teammates or rename the workspace later in Settings.
      </p>
    </AuthCard>
  );
}
