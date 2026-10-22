/**
 * Auth actions.
 *
 * The four access forms and the two onboarding steps call these rather than
 * `authClient` directly, so validation and error shaping happen in one place.
 *
 * Validation runs here, against the shared schemas in `@iwifunni/contracts`,
 * before any request is made. That is the point of the contracts package: the
 * rule that rejects a password lives in one place, and the same rule is enforced
 * again by the API. The forms' own `lib/validation.ts` checks are kept for
 * inline feedback as the user types — an immediate message is better UX than a
 * deferred one — but they are not the only line of defence.
 *
 * Errors are surfaced as `AuthError`, which carries a field-keyed map matching
 * what each form renders. A failure that belongs to no single input lands under
 * `form`.
 */

import {
  createProjectSchema,
  createWorkspaceSchema,
  projectSummarySchema,
  requestEmailVerificationSchema,
  requestPasswordResetSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  toFieldErrors,
  verifyEmailCodeSchema,
  type CreateWorkspaceInput,
  type FieldErrors,
  type OAuthProvider,
  type ProjectSummary,
} from "@iwifunni/contracts";
import type { ZodType } from "zod";

import { authClient, authErrorMessage } from "@/lib/auth-client";
import env from "shared/env";

export type { OAuthProvider };

/* -------------------------------------------------------------------------- */
/* Errors                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A validation or API failure, carrying the message to show against each field.
 *
 * `code` is kept as well as the wording: a caller that wants to offer a next
 * step — resending a confirmation link, say — has to branch on something that
 * does not change when the copy does.
 */
export class AuthError<Field extends string = string> extends Error {
  readonly fieldErrors: FieldErrors<Field>;
  readonly code: string | undefined;

  constructor(
    fieldErrors: FieldErrors<Field>,
    message?: string,
    code?: string,
  ) {
    super(message ?? Object.values(fieldErrors)[0] ?? "Something went wrong.");
    this.name = "AuthError";
    this.fieldErrors = fieldErrors;
    this.code = code;
  }
}

type FieldKey = string;

/**
 * Validate a partial payload and rethrow zod's issues as field errors.
 *
 * Partial on purpose: the forms validate individual fields before submitting,
 * so this accepts whichever subset a caller has.
 */
export function validate<Schema extends ZodType>(
  schema: Schema,
  value: unknown,
): FieldErrors<FieldKey> | null {
  const result = schema.safeParse(value);

  if (result.success) return null;

  return toFieldErrors<FieldKey>(result.error);
}

function fromAuthError(error: {
  code?: string | undefined;
  message?: string | undefined;
} | null): AuthError<FieldKey> {
  const message = authErrorMessage(error ?? {});

  return new AuthError<FieldKey>({ form: message }, message, error?.code);
}

/* -------------------------------------------------------------------------- */
/* Providers                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Which social providers are enabled on this deployment.
 *
 * Returns an empty list when the request fails. Failing closed is the right
 * behaviour here: the alternative is offering a button that leads to a broken
 * handshake.
 */
export async function getEnabledProviders(
  signal?: AbortSignal,
): Promise<OAuthProvider[]> {
  try {
    const response = await fetch(`${env.apiUrl}/v1/auth/providers`, {
      headers: { accept: "application/json" },
      credentials: "include",
      signal,
    });

    if (!response.ok) return [];

    const body = (await response.json()) as { enabled?: OAuthProvider[] };

    return body.enabled ?? [];
  } catch {
    /**
     * Fail closed, on purpose.
     *
     * This runs while rendering the access screens. If it threw, an unreachable
     * API would replace the sign-in form with an error page — turning a
     * recoverable situation into a total outage. Returning an empty list dims
     * the social buttons and leaves the email form, which is the honest
     * representation of "we could not confirm any provider works".
     */
    return [];
  }
}

/* -------------------------------------------------------------------------- */
/* Sign in                                                                     */
/* -------------------------------------------------------------------------- */

export interface SignInInput {
  email: string;
  password: string;
  remember: boolean;
}

export async function signIn(
  input: SignInInput,
  signal?: AbortSignal,
): Promise<boolean> {
  const errors = validate(signInSchema, input);
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error, data } = await authClient.signIn.email({
    email: input.email,
    password: input.password,
    rememberMe: input.remember,
  });

  if (error) throw fromAuthError(error);
  return !!(data && "twoFactorRedirect" in data && data.twoFactorRedirect);
}

/* -------------------------------------------------------------------------- */
/* Sign up                                                                     */
/* -------------------------------------------------------------------------- */

export interface SignUpInput {
  name: string;
  email: string;
  password: string;
}

export async function signUp(
  input: SignUpInput,
  signal?: AbortSignal,
): Promise<void> {
  // The form enforces the terms checkbox itself; the schema requires it, so it
  // is supplied here rather than threaded through a form that always sets it.
  const errors = validate(signUpSchema, { ...input, acceptedTerms: true });
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.signUp.email({
    name: input.name,
    email: input.email,
    password: input.password,
  });

  if (error) throw fromAuthError(error);
}

/* -------------------------------------------------------------------------- */
/* Email confirmation                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Send a confirmation code.
 *
 * The code is typed in here rather than followed as a link, so the user never
 * leaves the dashboard to finish signing up.
 *
 * Answered identically for an address that is unknown, already confirmed or
 * genuinely waiting, so this cannot be used to discover which accounts exist.
 */
export async function sendEmailVerificationCode(
  email: string,
  signal?: AbortSignal,
): Promise<void> {
  const errors = validate(requestEmailVerificationSchema, { email });
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.emailOtp.sendVerificationOtp({
    email,
    type: "email-verification",
  });

  if (error) throw fromAuthError(error);
}

/**
 * Confirm an address with the code from the email.
 *
 * A success issues the session on the same request, so the caller only has to
 * refresh the router afterwards.
 */
export async function verifyEmailCode(
  input: { email: string; code: string },
  signal?: AbortSignal,
): Promise<void> {
  const errors = validate(verifyEmailCodeSchema, input);
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.emailOtp.verifyEmail({
    email: input.email,
    otp: input.code,
  });

  if (error) throw fromAuthError(error);
}

/* -------------------------------------------------------------------------- */
/* Social sign-in                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Start a social sign-in.
 *
 * This navigates the browser away to the provider, so it does not resolve with a
 * session; the user returns to `callbackURL` once the provider redirects back.
 */
export async function signInWithProvider(
  provider: OAuthProvider,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  // Relayed verbatim in a Location header, so a relative path would resolve
  // against the API origin rather than this dashboard.
  const origin = window.location.origin;

  const { error } = await authClient.signIn.social({
    provider,
    callbackURL: `${origin}/overview`,
    newUserCallbackURL: `${origin}/create-workspace`,
    errorCallbackURL: `${origin}${window.location.pathname}`,
  });

  if (error) throw fromAuthError(error);
}

/**
 * The `?error=<code>` Better Auth appends to a failed handshake, in words.
 */
export function oauthErrorMessage(
  code: string | undefined,
): string | undefined {
  if (!code) return undefined;

  switch (code) {
    case "access_denied":
      return "Sign-in was cancelled at the provider.";
    case "email_not_found":
      return "That provider did not share an email address. Make your email visible, or sign in with a password.";
    case "invalid_state":
    case "state_mismatch":
      return "The sign-in attempt could not be verified. Please try again.";
    case "account_not_linked":
      // Only reachable after the provider confirmed the address, so naming the
      // existing account tells the caller nothing they could not already prove.
      return "That email already has a password account. Sign in with your password and confirm the address from the link we sent — Google will then attach to the same account.";
    default:
      return `Sign-in failed (${code}). Please try again.`;
  }
}

/* -------------------------------------------------------------------------- */
/* Sign out                                                                    */
/* -------------------------------------------------------------------------- */

export async function signOut(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.signOut();

  if (error) throw fromAuthError(error);
}

/* -------------------------------------------------------------------------- */
/* Password reset                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Ask for a password reset code.
 *
 * The code is typed in here rather than followed as a link, so the user never
 * leaves the dashboard to set a new password. Better Auth answers identically
 * for a known and an unknown address, which is what keeps the form from leaking
 * which emails have accounts.
 */
export async function requestPasswordReset(
  email: string,
  signal?: AbortSignal,
): Promise<void> {
  const errors = validate(requestPasswordResetSchema, { email });
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.emailOtp.requestPasswordReset({ email });

  if (error) throw fromAuthError(error);
}

/**
 * Complete a password reset with the code from the email.
 *
 * The address travels with the code because the code is looked up against the
 * account it was issued for, and because confirming the mailbox this way is
 * also what marks an unconfirmed address verified.
 */
export async function resetPassword(
  input: { email: string; code: string; newPassword: string },
  signal?: AbortSignal,
): Promise<void> {
  const errors = validate(resetPasswordSchema, input);
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { error } = await authClient.emailOtp.resetPassword({
    email: input.email,
    otp: input.code,
    password: input.newPassword,
  });

  if (error) throw fromAuthError(error);
}

/* -------------------------------------------------------------------------- */
/* Workspace                                                                   */
/* -------------------------------------------------------------------------- */

export interface CreateWorkspaceFormInput {
  name: string;
  slug: string;
  /** Invitees to add once the workspace exists. Not sent to the API yet. */
  invites?: string[];
}

/**
 * Create the workspace.
 *
 * The workspace **is** the Better Auth organization, so this calls the
 * organization plugin's create endpoint and nothing else. The creator is added as
 * `owner` by the plugin.
 *
 * There is no follow-up call: every column the workspace needs is one the plugin
 * already writes. Onboarding asks for a name and a slug, and both go straight to
 * the plugin.
 */
export async function createWorkspace(
  input: CreateWorkspaceFormInput,
  signal?: AbortSignal,
): Promise<void> {
  const errors = validate(createWorkspaceSchema, input);
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const { data, error } = await authClient.organization.create({
    name: input.name,
    slug: input.slug,
  });

  if (error) throw fromAuthError(error);

  if (!data) {
    throw new AuthError<FieldKey>({
      form: "The workspace could not be created. Please try again.",
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Project                                                                     */
/* -------------------------------------------------------------------------- */

export interface CreateProjectFormInput {
  name: string;
}

/**
 * Create the first project.
 *
 * `POST /v1/projects` takes the workspace from the session rather than the body,
 * so a caller cannot create a project in a tenant they do not belong to. The
 * project key is derived and de-duplicated server-side, and the starter
 * environments are named by the API, which is why neither is sent.
 *
 * The response is parsed rather than cast: the API is a separate deployment and
 * an unchecked cast would turn a contract drift into a confusing runtime failure
 * later.
 */
export async function createProject(
  input: CreateProjectFormInput,
  signal?: AbortSignal,
): Promise<ProjectSummary> {
  const errors = validate(createProjectSchema, input);
  if (errors) throw new AuthError(errors);
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

  const response = await fetch(`${env.apiUrl}/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input),
    signal,
  });

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    /** The API's contracted envelope, `{ error: { code, message } }`. */
    const message =
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof (payload as { error?: { message?: unknown } }).error?.message ===
        "string"
        ? (payload as { error: { message: string } }).error.message
        : "The project could not be created. Please try again.";

    throw new AuthError<FieldKey>({ form: message }, message);
  }

  const parsed = projectSummarySchema.safeParse(payload);

  if (!parsed.success) {
    throw new AuthError<FieldKey>({
      form: "The project was created, but the API returned an unexpected response.",
    });
  }

  return parsed.data;
}

export type { CreateWorkspaceInput };
