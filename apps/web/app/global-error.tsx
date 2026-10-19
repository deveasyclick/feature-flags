"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

import { captureException } from "@/shared/analytics";

export default function GlobalError({
  error,
}: {
  readonly error: Error & { digest?: string };
}) {
  useEffect(() => {
    // Sentry stays the error tracker; PostHog receives the exception too so the
    // failure links to the session it happened in. React hands a rendering
    // failure to this boundary rather than to the SDK's global handlers, so this
    // call is what gets it there.
    Sentry.captureException(error);
    captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        {/* `NextError` is the default Next.js error page component. Its type
        definition requires a `statusCode` prop. However, since the App Router
        does not expose status codes for errors, we simply pass 0 to render a
        generic error message. */}
        <NextError statusCode={0} />
      </body>
    </html>
  );
}
