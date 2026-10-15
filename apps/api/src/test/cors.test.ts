import { beforeAll, describe, expect, it } from "vitest";

import { dashboardOrigins } from "../shared/constants.js";
import { loadApp } from "./harness.js";

// Read from the list the server allows rather than written out again. A second
// copy is what let the production origin move in `app.ts` while this file kept
// asserting the old one - which passes the status and fails the header, so the
// dashboard is refused by a browser with a green test suite behind it.
const DASHBOARD_ORIGIN = dashboardOrigins[1] ?? "";
const LOCAL_ORIGIN = dashboardOrigins[0] ?? "";

// The deployment the dashboard is actually served from. Asserted so that moving
// the allowed origins is a deliberate act a test states, rather than an edit to a
// constant that everything else quietly follows.
const PRODUCTION_DASHBOARD_ORIGIN = "https://flags.iwifunni.cc";

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
    expect(auth.options.trustedOrigins).toEqual(dashboardOrigins);
  });
});

describe("the allowed origins", () => {
  it("serve the deployment the dashboard is on, and the local one", () => {
    expect(dashboardOrigins).toEqual([
      LOCAL_ORIGIN,
      PRODUCTION_DASHBOARD_ORIGIN,
    ]);
  });
});
