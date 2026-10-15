"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircleIcon } from "lucide-react";
import { VERIFICATION_CODE_LENGTH } from "@iwifunni/contracts";
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
  signInWithProvider,
  signUp,
  verifyEmailCode,
  type OAuthProvider,
} from "@/lib/auth";
import { isEmail, isRequired } from "@/lib/validation";

type Action = OAuthProvider | "credentials" | "code" | "resend";

interface SignUpErrors {
  form?: string;
  name?: string;
  email?: string;
  password?: string;
  terms?: string;
  code?: string;
}

interface SignUpFormProps {
  readonly enabledProviders: OAuthProvider[];
  /** An error handed back by the OAuth callback, if any. */
  readonly initialError?: string;
}

export function SignUpForm({
  enabledProviders,
  initialError,
}: SignUpFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [errors, setErrors] = useState<SignUpErrors>(
    initialError ? { form: initialError } : {},
  );
  const [pending, setPending] = useState<Action | null>(null);
  /**
   * The address a confirmation code went to, once one has.
   *
   * Sign-up deliberately issues no session while `requireEmailVerification` is
   * on, so there is nowhere to push the user: the account exists, but the
   * password will not work until the code is entered. This is that wait, and it
   * happens here rather than behind a link so the user never leaves the site.
   */
  const [awaiting, setAwaiting] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [resent, setResent] = useState(false);
  const router = useRouter();
  const controllerRef = useRef<AbortController | null>(null);

  function clearError(field: keyof SignUpErrors) {
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
          ...(error.fieldErrors as SignUpErrors),
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

  function handleProvider(provider: OAuthProvider) {
    return run(provider, (signal) => signInWithProvider(provider, signal));
  }

  function handleResend(address: string) {
    setResent(false);
    return run("resend", async (signal) => {
      await sendEmailVerificationCode(address, signal);
      setResent(true);
    });
  }

  function handleConfirm(address: string) {
    return run("code", async (signal) => {
      await verifyEmailCode({ email: address, code }, signal);

      // Confirming issues the session, so the shell has to be re-read from the
      // server before navigating into it.
      router.refresh();
      router.push("/create-workspace");
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextErrors: SignUpErrors = {
      name: isRequired(name, "Name") ?? undefined,
      email: isRequired(email, "Email") ?? isEmail(email) ?? undefined,
      password:
        isRequired(password, "Password") ??
        (password.length < 8
          ? "Password must be at least 8 characters."
          : undefined),
      terms: acceptedTerms
        ? undefined
        : "Please accept the Terms and Privacy Policy to continue.",
    };

    if (
      nextErrors.name ||
      nextErrors.email ||
      nextErrors.password ||
      nextErrors.terms
    ) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    void run("credentials", async (signal) => {
      await signUp(
        { name: name.trim(), email: email.trim(), password },
        signal,
      );

      setAwaiting(email.trim());
    });
  }

  if (awaiting) {
    const address = awaiting;

    return (
      <AuthCard
        title="Confirm your email"
        description={
          <>
            We emailed a {VERIFICATION_CODE_LENGTH}-digit code to{" "}
            <strong>{address}</strong>. Enter it below to finish setting up your
            account — until then, the password you chose will not sign you in.
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleConfirm(address);
          }}
          noValidate
          className="space-y-4"
        >
          <Field
            id="sign-up-code"
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
            {pending === "code" ? "Confirming…" : "Confirm and continue"}
          </Button>
        </form>

        <Button
          type="button"
          variant="ghost"
          className="mt-3 w-full"
          disabled={pending !== null}
          onClick={() => void handleResend(address)}
        >
          {pending === "resend" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          {resent ? "A new code is on its way" : "Send a new code"}
        </Button>

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Wrong address?{" "}
          <button
            type="button"
            className="text-primary font-medium hover:underline"
            onClick={() => {
              setAwaiting(null);
              setCode("");
              setResent(false);
              setErrors({});
            }}
          >
            Start over
          </button>
        </p>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Create your account"
      description="Set up your Iwifunni account. We'll email you a code to confirm your address, then you'll create a workspace and your first project."
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
          id="sign-up-name"
          label="Name"
          name="name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          required
          value={name}
          error={errors.name}
          onChange={(event) => {
            setName(event.target.value);
            clearError("name");
          }}
        />

        <Field
          id="sign-up-email"
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
          id="sign-up-password"
          label="Password"
          name="password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          required
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            clearError("password");
          }}
        />

        <div className="space-y-2">
          <FieldRow
            htmlFor="sign-up-terms"
            control={
              <Checkbox
                id="sign-up-terms"
                name="terms"
                aria-invalid={errors.terms ? true : undefined}
                aria-describedby={
                  errors.terms ? "sign-up-terms-error" : undefined
                }
                checked={acceptedTerms}
                onCheckedChange={(checked) => {
                  setAcceptedTerms(checked === true);
                  clearError("terms");
                }}
              />
            }
          >
            I agree to the Terms of Service and Privacy Policy.
          </FieldRow>
          {errors.terms ? (
            <FieldError id="sign-up-terms-error">{errors.terms}</FieldError>
          ) : null}
        </div>

        {errors.form ? <FieldError>{errors.form}</FieldError> : null}

        <Button type="submit" className="w-full" disabled={pending !== null}>
          {pending === "credentials" ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          {pending === "credentials" ? "Creating account…" : "Create account"}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-center text-sm">
        Already have an account?{" "}
        <Link href="/" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </AuthCard>
  );
}
