"use client";

import { useRef, useState } from "react";
import { CheckIcon, KeyRoundIcon, LoaderCircleIcon } from "lucide-react";
import { changePasswordSchema, toFieldErrors } from "@iwifunni/contracts";
import { SettingsCard } from "@/components/app/settings-card";
import { Field, FieldError } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import * as api from "@/lib/api";
import { isRequired, isStrongPassword } from "@/lib/validation";

interface PasswordErrors {
  form?: string;
  current?: string;
  next?: string;
}

export function PasswordForm() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [errors, setErrors] = useState<PasswordErrors>({});
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  function update(setter: (value: string) => void, field: keyof PasswordErrors) {
    return (value: string) => {
      setter(value);
      setSaved(false);
      setErrors((previous) => ({
        ...previous,
        form: undefined,
        [field]: undefined,
      }));
    };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors: PasswordErrors = {
      current: isRequired(current, "Current password") ?? undefined,
      next: isStrongPassword(next, "New password") ?? undefined,
    };
    if (nextErrors.current || nextErrors.next) {
      setErrors(nextErrors);
      return;
    }

    const parsed = changePasswordSchema.safeParse({
      currentPassword: current,
      newPassword: next,
    });

    if (!parsed.success) {
      const fieldErrors = toFieldErrors<"currentPassword" | "newPassword">(
        parsed.error,
      );
      setErrors({
        current: fieldErrors.currentPassword,
        next: fieldErrors.newPassword,
      });
      return;
    }

    setErrors({});
    setPending(true);
    setSaved(false);
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await api.me.changePassword(parsed.data, { signal: controller.signal });
      setCurrent("");
      setNext("");
      setSaved(true);
    } catch (caught) {
      if ((caught as Error)?.name === "AbortError") return;

      setErrors({
        form:
          caught instanceof api.ApiError
            ? caught.message
            : "Your password could not be changed. Please try again.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <SettingsCard
        title="Password"
        description="Use at least 12 characters with a mix of letters and numbers."
        footer={
          <div className="flex items-center justify-between gap-3">
            {saved ? (
              <span className="text-ok-ink inline-flex items-center gap-1.5 text-[11px]">
                <CheckIcon aria-hidden="true" className="size-3.5" />
                Password updated just now
              </span>
            ) : (
              <span className="text-muted-foreground text-[11px]">
                Not updated
              </span>
            )}

            <Button
              type="submit"
              size="sm"
              className="gap-1.5 text-[11px]"
              disabled={pending}
            >
              {pending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <KeyRoundIcon aria-hidden="true" className="size-3.5" />
              )}
              {pending ? "Updating…" : "Update password"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field
            id="profile-current-password"
            label="Current password"
            name="current-password"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            error={errors.current}
            onChange={(event) => update(setCurrent, "current")(event.target.value)}
          />

          <Field
            id="profile-new-password"
            label="New password"
            name="new-password"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            error={errors.next}
            onChange={(event) => update(setNext, "next")(event.target.value)}
          />

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}
        </div>
      </SettingsCard>
    </form>
  );
}
