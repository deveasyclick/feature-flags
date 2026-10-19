/**
 * Runtime configuration for the web application.
 *
 * `next.config.ts` loads `apps/web/.env` before the build runs, so these values
 * are already on `process.env` by the time this module is evaluated. Only
 * variables prefixed with `NEXT_PUBLIC_` reach the browser; everything else is
 * server-only and must not be imported from a Client Component.
 */

type Environment = "development" | "test" | "production";

const DEFAULT_API_URL = "http://localhost:4000";

function readEnvironment(): Environment {
  const value = process.env.NODE_ENV;

  return value === "production" || value === "test" ? value : "development";
}

function readApiUrl(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL;

  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "NEXT_PUBLIC_API_URL must be set for production builds. Copy apps/web/.env.example to apps/web/.env and provide the Iwifunni API base URL.",
      );
    }

    return DEFAULT_API_URL;
  }

  return raw.replace(/\/+$/, "");
}

/**
 * Base URL Server Components use to reach the API.
 *
 * Kept separate from `apiUrl` because the server may reach the API over a
 * private address while the browser uses a public one. In development both are
 * the same; in production the API sits behind the same origin.
 */
function readApiInternalUrl(): string {
  return (process.env.API_INTERNAL_URL ?? DEFAULT_API_URL).replace(/\/+$/, "");
}

/**
 * A public variable that may legitimately be absent.
 *
 * Unset and empty answer the same way, because a copied `.env.example` leaves
 * the value empty and that has to mean "not configured" rather than
 * "configured with a blank token".
 */
function readOptionalPublic(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

/**
 * The application's configuration.
 *
 *   import env from "shared/env";
 *
 *   env.environment; // "development" | "test" | "production"
 */
const env = {
  environment: readEnvironment(),
  apiUrl: readApiUrl(),
  apiInternalUrl: readApiInternalUrl(),
  // Browser analytics. Both are optional: without them the app runs and sends
  // nothing, which is what a local checkout that has not configured PostHog and
  // every test do.
  analyticsKey: readOptionalPublic(process.env.NEXT_PUBLIC_POSTHOG_KEY),
  analyticsHost: readOptionalPublic(process.env.NEXT_PUBLIC_POSTHOG_HOST),
} as const;

export default env;
