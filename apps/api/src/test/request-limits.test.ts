import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createRequestLimits } from "../middleware/request-limits.js";
import { errorResponse } from "../shared/http/errors.js";

describe("request limits", () => {
  it("returns the contracted rate limit error and retry interval", async () => {
    const app = new Hono();
    app.use("*", createRequestLimits(1));
    app.get("/", (c) => c.text("ok"));
    app.onError((error, c) => errorResponse(c, error));
    expect((await app.request("/")).status).toBe(200);
    const refused = await app.request("/");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    await expect(refused.json()).resolves.toMatchObject({
      error: { code: "rate_limited" },
    });
  });
});
