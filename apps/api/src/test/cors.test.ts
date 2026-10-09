import { beforeAll, describe, expect, it } from "vitest";

import { loadApp } from "./harness.js";

const DASHBOARD_ORIGIN = "https://dariise.yusufadeniyi.dev";
const LOCAL_ORIGIN = "http://localhost:3000";

type App = Awaited<ReturnType<typeof loadApp>>;

let app: App;

beforeAll(async () => {
  app = await loadApp();
});

describe("credentialed CORS", () => {
  it("answers the preflight the dashboard sends before social sign-in", async () => {
    const response = await app.request("/api/auth/sign-in/social", {
      method: "OPTIONS",
      headers: {
        origin: DASHBOARD_ORIGIN,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      DASHBOARD_ORIGIN,
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
  });

  it("allows the local dashboard origin", async () => {
    const response = await app.request("/healthz", {
      headers: { origin: LOCAL_ORIGIN },
    });

    expect(response.headers.get("access-control-allow-origin")).toBe(
      LOCAL_ORIGIN,
    );
  });

  it("withholds the allow-origin header from an origin that is not listed", async () => {
    const response = await app.request("/healthz", {
      headers: { origin: "https://evil.example" },
    });

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("trusts exactly the origins CORS allows, with no trailing slash", async () => {
    const { auth } = await import("../app.js");

    // Asserted rather than exercised: Better Auth sets `skipOriginCheck` under
    // `NODE_ENV=test`, so no request here reaches the check that answers an
    // unlisted origin with 403. Without this, a trailing slash is invisible.
    expect(auth.options.trustedOrigins).toEqual([
      LOCAL_ORIGIN,
      DASHBOARD_ORIGIN,
    ]);
  });
});
