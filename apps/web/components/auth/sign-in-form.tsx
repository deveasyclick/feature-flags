"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { GitHubIcon, GoogleIcon } from "@/components/auth/brand-icons";
import {
  Field,
  FieldError,
  FieldRow,
  PasswordField,
} from "@/components/auth/field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  AuthError,
  sendEmailVerificationCode,
  signIn,
  signInWithProvider,
  verifyEmailCode,
  type OAuthProvider,
} from "@/lib/auth";
import { isEmail, isRequired } from "@/lib/validation";
import { VERIFICATION_CODE_LENGTH } from "@iwifunni/contracts";

type Action = OAuthProvider | "credentials" | "code" | "resend";

interface SignInErrors {
  form?: string;
  email?: string;
  password?: string;
  code?: string;
}

interface SignInFormProps {
  readonly enabledProviders: OAuthProvider[];
  /** An error handed back by the OAuth callback, if any. */
  readonly initialError?: string;
}

export function SignInForm({
  enabledProviders,
  initialError,
}: SignInFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [errors, setErrors] = useState<SignInErrors>(
    initialError ? { form: initialError } : {},
  );
  const [pending, setPending] = useState<Action | null>(null);
  /**
   * Set when the API accepted the password but refused the sign-in because the
   * address was never confirmed. A code is the only thing missing, and one has
   * been sent, so the form swaps to asking for it rather than leaving the user
   * to guess what went wrong.
   */
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);

  function clearError(field: keyof SignInErrors) {
    setErrors((previous) => ({
      ...previous,
      form: undefined,
      [field]: undefined,
    }));
  }

  async function run(
    action: Action,
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
          ...(error.fieldErrors as SignInErrors),
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

  /**
   * `refresh()` before `push()`, because the session cookie was just set on the
   * API origin.
   *
   * The destination — whether the user has a workspace, what the sidebar shows
   * — is resolved on the server from that cookie. `push()` alone would navigate
   * against a Router Cache populated while signed out, so the shell would render
   * as a signed-out user; `refresh()` discards that cache and re-renders the
   * current tree from the server first.
   */
  function goToDashboard() {
    router.refresh();
    router.push("/overview");
  }

  function handleProvider(provider: OAuthProvider) {
    return run(provider, async (signal) => {
      await signInWithProvider(provider, signal);

      goToDashboard();
    });
  }

  function handleResend() {
    setResent(false);
    return run("resend", async (signal) => {
      await sendEmailVerificationCode(email.trim(), signal);
      setResent(true);
    });
  }

  function handleConfirm() {
    return run("code", async (signal) => {
      await verifyEmailCode({ email: email.trim(), code }, signal);

      goToDashboard();
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: SignInErrors = {
      email: isRequired(email, "Email") ?? isEmail(email) ?? undefined,
      password:
        isRequired(password, "Password") ??
        (password.length < 8
          ? "Password must be at least 8 characters."
          : undefined),
    };

    if (nextErrors.email || nextErrors.password) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setUnconfirmed(false);
    setResent(false);
    setCode("");

    void run("credentials", async (signal) => {
      const address = email.trim();

      try {
        await signIn({ email: address, password, remember }, signal);
      } catch (error) {
        if (
          error instanceof AuthError &&
          error.code === "EMAIL_NOT_VERIFIED"
        ) {
          /**
           * The password was right; only the address is unconfirmed. Sending a
           * code here rather than behind another button is the difference
           * between a next step and a dead end — and it cannot be abused,
           * because reaching this branch already required the password.
           */
          await sendEmailVerificationCode(address, signal);
          setUnconfirmed(true);
          return;
        }

        throw error;
      }

      goToDashboard();
    });
  }

  if (unconfirmed) {
    const address = email.trim();

    return (
      <AuthCard
        title="Confirm your email"
        description={
          <>
            We emailed a {VERIFICATION_CODE_LENGTH}-digit code to{" "}
            <strong>{address}</strong>. Enter it below to finish signing in.
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleConfirm();
          }}
          noValidate
          className="space-y-4"
        >
          <Field
            id="sign-in-code"
            label="Confirmation code"
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

          {errors.form ? <FieldError>{errors.form}</FieldError> : null}

          <Button
            type="submit"
            className="w-full"
            disabled={pending !== null}
          >
            {pending === "code" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {pending === "code" ? "Confirming…" : "Confirm and sign in"}
          </Button>
        </form>

        <div className="mt-3 flex flex-col gap-1">
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending !== null}
            onClick={() => void handleResend()}
          >
            {pending === "resend" ? (
              <LoaderCircleIcon className="animate-spin" />
            ) : null}
            {resent ? "A new code is on its way" : "Send a new code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            disabled={pending !== null}
            onClick={() => {
              setUnconfirmed(false);
              setCode("");
              setResent(false);
              setErrors({});
            }}
          >
            Use a different account
          </Button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Sign in to Iwifunni"
      description="Welcome back — the place to manage your feature flags."
    >
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null || !enabledProviders.includes("github")}
          title={
            enabledProviders.includes("github")
              ? undefined
              : "GitHub sign-in is not configured on this deployment"
          }
          onClick={() => handleProvider("github")}
        >
          {pending === "github" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <GitHubIcon className="size-4" />
          )}
          {pending === "github" ? "Redirecting…" : "Continue with GitHub"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={pending !== null || !enabledProviders.includes("google")}
          title={
            enabledProviders.includes("google")
              ? undefined
              : "Google sign-in is not configured on this deployment"
          }
          onClick={() => handleProvider("google")}
        >
          {pending === "google" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : (
            <GoogleIcon className="size-4" />
          )}
          {pending === "google" ? "Redirecting…" : "Continue with Google"}
        </Button>
      </div>

      <div className="my-6 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-muted-foreground text-xs">OR</span>
        <Separator className="flex-1" />
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field
          id="sign-in-email"
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

        <PasswordField
          id="sign-in-password"
          label="Password"
          name="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
          value={password}
          error={errors.password}
          labelSuffix={
            <Link
              href="/forgot-password"
              className="text-primary text-xs font-medium hover:underline"
            >
              Forgot password?
            </Link>
          }
          onChange={(event) => {
            setPassword(event.target.value);
            clearError("password");
          }}
        />

        <FieldRow
          htmlFor="sign-in-remember"
          control={
            <Checkbox
              id="sign-in-remember"
              name="remember"
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
          }
        >
          Remember me
        </FieldRow>

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <Button type="submit" className="w-full" disabled={pending !== null}>
          {pending === "credentials" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          {pending === "credentials" ? "Signing in…" : "Sign in"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Don&apos;t have an account?{" "}
        <Link
          href="/sign-up"
          className="text-primary font-medium hover:underline"
        >
          Create one
        </Link>
      </p>
    </AuthCard>
  );
}
