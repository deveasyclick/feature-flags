import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic route gate.
 *
 * Next.js 16 renamed this convention from `middleware` to `proxy`, and proxy
 * defaults to the Node.js runtime. The rename is why this file is `proxy.ts`
 * rather than `middleware.ts`.
 *
 * This does **not** verify the session. It checks for the presence of Better
 * Auth's session cookie and redirects when it is absent. That is deliberate:
 * proxy runs on every matched request, and asking the API to validate a session
 * there would put a network round trip in front of everything.
 *
 * It is therefore a fast path, not the authorization boundary. The real check
 * lives in `app/(app)/layout.tsx`, which resolves the session server-side and
 * also gates on whether a workspace exists. A forged cookie gets past this
 * proxy and is rejected by the layout — that order is safe; the reverse would
 * not be.
 *
 * `(getting-started)` is matched because its only step, create-project, is
 * meaningless without an account: there would be no workspace to attach a
 * project to.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie =
    request.cookies.has("better-auth.session_token") ||
    request.cookies.has("__Secure-better-auth.session_token");

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const signIn = new URL("/sign-in", request.url);

  /**
   * Preserve where the user was heading. Only the pathname is carried, never the
   * full URL — reading a destination from the request would make this an open
   * redirect.
   */
  signIn.searchParams.set("next", request.nextUrl.pathname);

  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ["/overview/:path*", "/create-project/:path*"],
};
