import type { Context, MiddlewareHandler } from "hono";
import { createMiddleware } from "hono/factory";

import type {
  RequestContext,
  SessionEnv,
  WorkspaceMembership,
} from "../modules/auth/auth.types.js";
import { ApiError } from "../shared/http/errors.js";

/** Resolves a request's session context, or `null` when it is unauthenticated. */
export type SessionResolver = (
  headers: Headers,
) => Promise<RequestContext | null>;

// Takes the resolver the composition root wired up, so this file imports no module
// instance or service class.
export function createSessionMiddleware(
  resolve: SessionResolver,
): MiddlewareHandler {
  return createMiddleware<SessionEnv>(async (c, next) => {
    c.set("session", await resolve(c.req.raw.headers));
    await next();
  });
}

export async function requireSession(
  c: Context<SessionEnv>,
  allowMfaPending = false,
): Promise<RequestContext> {
  const context = c.get("session");

  if (!context) {
    throw ApiError.unauthorized();
  }
  if (context.mfaRequired && !allowMfaPending) throw ApiError.mfaRequired();
  if (context.mfaEnrollmentRequired && !allowMfaPending)
    throw ApiError.mfaEnrollmentRequired();

  return context;
}

export async function requireWorkspace(
  c: Context<SessionEnv>,
): Promise<RequestContext & { workspace: WorkspaceMembership }> {
  const context = await requireSession(c);

  if (!context.workspace) {
    throw ApiError.notFound("No workspace found for this account.");
  }

  return { ...context, workspace: context.workspace };
}
