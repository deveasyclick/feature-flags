"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, LoaderCircleIcon } from "lucide-react";
import { PASSWORD_MIN_LENGTH, VERIFICATION_CODE_LENGTH } from "@iwifunni/contracts";
import { AuthCard } from "@/components/auth/auth-card";
import { Field, FieldError, PasswordField } from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { AuthError, requestPasswordReset, resetPassword } from "@/lib/auth";
import { isEmail, isRequired } from "@/lib/validation";

type Step = "email" | "code";

interface ForgotPasswordErrors {
  form?: string;
  email?: string;
  code?: string;
  newPassword?: string;
  confirmPassword?: string;
}

/**
 * Password reset in two steps on one page.
 *
 * The code is entered here rather than followed from a link, so the whole flow
 * happens on the dashboard. Keeping both steps in one component also keeps the
 * address in memory, which is what the code has to be presented against.
 */
export function ForgotPasswordForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<ForgotPasswordErrors>({});
  const [pending, setPending] = useState<"email" | "reset" | null>(null);
  const [done, setDone] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  function clearError(...fields: (keyof ForgotPasswordErrors)[]) {
    setErrors((previous) => {
      const next = { ...previous, form: undefined };

      for (const field of fields) {
        next[field] = undefined;
      }

      return next;
    });
  }

  async function run(
    action: "email" | "reset",
    task: (signal: AbortSignal) => Promise<void>,
  ) {
    if (pending) return;
    setPending(action);
    setErrors((previous) => ({ ...previous, form: undefined }));
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      await task(controller.signal);
    } catch (error) {
      if ((error as Error)?.name === "AbortError") return;

      if (error instanceof AuthError) {
        setErrors((previous) => ({
          ...previous,
          ...(error.fieldErrors as ForgotPasswordErrors),
        }));
        return;
      }

      setErrors((previous) => ({
        ...previous,
        form: "Something went wrong. Please try again.",
      }));
    } finally {
      setPending(null);
    }
  }

  function handleRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const emailError = isRequired(email, "Email") ?? isEmail(email) ?? undefined;

    if (emailError) {
      setErrors({ email: emailError });
      return;
    }

    void run("email", async (signal) => {
      await requestPasswordReset(email.trim(), signal);

      setStep("code");
    });
  }

  function handleReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: ForgotPasswordErrors = {
      code: /^\d+$/.test(code)
        ? undefined
        : `Enter the ${VERIFICATION_CODE_LENGTH}-digit code.`,
      newPassword:
        newPassword.length < PASSWORD_MIN_LENGTH
          ? `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`
          : undefined,
      confirmPassword:
        confirmPassword !== newPassword
          ? "Both passwords must match."
          : undefined,
    };

    if (nextErrors.code || nextErrors.newPassword || nextErrors.confirmPassword) {
      setErrors(nextErrors);
      return;
    }

    void run("reset", async (signal) => {
      await resetPassword(
        { email: email.trim(), code, newPassword },
        signal,
      );

      setDone(true);
    });
  }

  if (done) {
    return (
      <AuthCard
        title="Password updated"
        description="Your password has been changed. Sign in with your new password."
        backLink={<BackToSignIn />}
      >
        <Button asChild className="w-full">
          <Link href="/sign-in">Return to sign in</Link>
        </Button>
      </AuthCard>
    );
  }

  if (step === "code") {
    return (
      <AuthCard
        title="Choose a new password"
        description={
          <>
            If an account exists for{" "}
            <span className="text-foreground font-medium">{email.trim()}</span>,
            a {VERIFICATION_CODE_LENGTH}-digit code is on its way. It expires in
            10 minutes.
          </>
        }
        backLink={<BackToSignIn />}
      >
        <form onSubmit={handleReset} noValidate className="space-y-4">
          <Field
            id="reset-password-code"
            label="Reset code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={"0".repeat(VERIFICATION_CODE_LENGTH)}
            maxLength={VERIFICATION_CODE_LENGTH}
            required
            value={code}
            error={errors.code}
            onChange={(event) => {
              setCode(event.target.value);
              clearError("code");
            }}
          />

          <PasswordField
            id="reset-password-new"
            label="New password"
            name="newPassword"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            value={newPassword}
            error={errors.newPassword}
            onChange={(event) => {
              setNewPassword(event.target.value);
              clearError("newPassword");
            }}
          />

          <PasswordField
            id="reset-password-confirm"
            label="Confirm new password"
            name="confirmPassword"
            autoComplete="new-password"
            placeholder="••••••••"
            required
            value={confirmPassword}
            error={errors.confirmPassword}
            onChange={(event) => {
              setConfirmPassword(event.target.value);
              clearError("confirmPassword");
            }}
          />

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <Button type="submit" className="w-full" disabled={pending !== null}>
            {pending === "reset" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {pending === "reset" ? "Updating password…" : "Update password"}
          </Button>
        </form>

        <div className="mt-3 flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending !== null}
            onClick={() =>
              void run("email", (signal) =>
                requestPasswordReset(email.trim(), signal),
              )
            }
          >
            {pending === "email" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            Send a new code
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              setStep("email");
              setCode("");
              setErrors({});
            }}
          >
            Use a different email
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Reset your password"
      description="Enter the email you use for Iwifunni and we'll send you a reset code."
      backLink={<BackToSignIn />}
    >
      <form onSubmit={handleRequest} noValidate className="space-y-4">
        <Field
          id="forgot-password-email"
          label="Email"
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@company.com"
          required
          value={email}
          error={errors.email}
          onChange={(event) => {
            setEmail(event.target.value);
            clearError("email");
          }}
        />

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <Button
          type="submit"
          className="w-full"
          disabled={pending !== null}
        >
          {pending === "email" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          {pending === "email" ? "Sending code…" : "Send reset code"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link href="/sign-up" className="text-primary font-medium hover:underline">
          Sign up
        </Link>
      </p>
    </AuthCard>
  );
}

function BackToSignIn() {
  return (
    <Link
      href="/sign-in"
      className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors"
    >
      <ArrowLeftIcon aria-hidden="true" className="size-4" />
      Back to sign in
    </Link>
  );
}
