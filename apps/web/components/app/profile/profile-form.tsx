"use client";

import { useRef, useState } from "react";
import { CameraIcon, CheckIcon, LoaderCircleIcon } from "lucide-react";
import {
  toFieldErrors,
  updateProfileSchema,
  type SessionUser,
} from "@iwifunni/contracts";
import { SettingsCard } from "@/components/app/settings-card";
import { Field, FieldError } from "@/components/auth/field";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { isEmail, isRequired } from "@/lib/validation";

interface ProfileErrors {
  form?: string;
  name?: string;
  email?: string;
}

interface ProfileDraft {
  name: string;
  email: string;
}

export function ProfileForm({
  user,
  initials,
}: {
  readonly user: SessionUser;
  readonly initials: string;
}) {
  const initial: ProfileDraft = { name: user.name, email: user.email };

  const [draft, setDraft] = useState<ProfileDraft>(initial);
  const [baseline, setBaseline] = useState<ProfileDraft>(initial);
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const dirty =
    draft.name !== baseline.name || draft.email !== baseline.email;

  function update(patch: Partial<ProfileDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setSaved(false);
    setErrors((current) => ({
      ...current,
      form: undefined,
      name: undefined,
      email: undefined,
    }));
  }

  async function handleSave() {
    if (pending || !dirty) return;

    const nextErrors: ProfileErrors = {
      name: isRequired(draft.name, "Full name") ?? undefined,
      email: isEmail(draft.email) ?? undefined,
    };
    if (nextErrors.name || nextErrors.email) {
      setErrors(nextErrors);
      return;
    }

    const next: ProfileDraft = {
      name: draft.name.trim(),
      email: draft.email.trim(),
    };
    const parsed = updateProfileSchema.safeParse(next);

    if (!parsed.success) {
      const fieldErrors = toFieldErrors<"name" | "email">(parsed.error);
      setErrors({ name: fieldErrors.name, email: fieldErrors.email });
      return;
    }

    setErrors({});
    setPending(true);
    setSaved(false);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const updated = await api.me.updateProfile(parsed.data, {
        signal: controller.signal,
      });
      const accepted: ProfileDraft = {
        name: updated.name,
        email: updated.email,
      };

      setDraft(accepted);
      setBaseline(accepted);
      setSaved(true);
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setErrors({
        form:
          caught instanceof api.ApiError
            ? caught.message
            : "Your profile could not be saved. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsCard
      title="Profile"
      description="This is how you appear to teammates across the workspace."
      footer={
        <div className="flex items-center justify-between gap-3">
          {saved && !dirty ? (
            <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
              <CheckIcon aria-hidden="true" className="size-3.5" />
              Saved just now
            </span>
          ) : (
            <span className="text-muted-foreground text-[11px]">
              {dirty ? "Unsaved changes" : "No changes"}
            </span>
          )}

          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-[11px]"
            disabled={pending || !dirty}
            onClick={handleSave}
          >
            {pending ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : (
              <CheckIcon aria-hidden="true" className="size-3.5" />
            )}
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Avatar size="lg">
            <AvatarFallback className="bg-nav-active text-[12px] font-medium text-white">
              {initials}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium">{user.name}</p>
            <p className="text-muted-foreground truncate text-[11px]">
              {user.email}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled
            title="Changing your photo — coming soon"
            className="shrink-0 gap-1.5 text-[11px]"
          >
            <CameraIcon aria-hidden="true" className="size-3.5" />
            Change photo
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="profile-name"
            label="Full name"
            name="name"
            required
            maxLength={60}
            value={draft.name}
            error={errors.name}
            onChange={(event) => update({ name: event.target.value })}
          />

          <Field
            id="profile-email"
            label="Email"
            name="email"
            type="email"
            required
            value={draft.email}
            error={errors.email}
            onChange={(event) => update({ email: event.target.value })}
          />
        </div>

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}
      </div>
    </SettingsCard>
  );
}
