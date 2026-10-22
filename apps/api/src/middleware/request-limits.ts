import { createMiddleware } from "hono/factory";
import { getConnInfo } from "@hono/node-server/conninfo";
import { ApiError } from "../shared/http/errors.js";

export function createRequestLimits(limit: number, windowMs = 60_000) {
  const buckets = new Map<string, { count: number; expiresAt: number }>();
  return createMiddleware(async (c, next) => {
    if (limit === 0 || c.req.path === "/healthz" || c.req.path === "/readyz")
      return next();
    let address = "unknown";
    try {
      address = getConnInfo(c).remote.address ?? address;
    } catch {}
    const now = Date.now();
    let bucket = buckets.get(address);
    if (!bucket || bucket.expiresAt <= now) {
      if (buckets.size >= 10_000) {
        for (const [key, value] of buckets)
          if (value.expiresAt <= now) buckets.delete(key);
        if (buckets.size >= 10_000) throw ApiError.rateLimited();
      }
      bucket = { count: 0, expiresAt: now + windowMs };
      buckets.set(address, bucket);
    }
    bucket.count += 1;
    if (bucket.count > limit) {
      c.header(
        "Retry-After",
        String(Math.ceil((bucket.expiresAt - now) / 1000)),
      );
      throw ApiError.rateLimited();
    }
    return next();
  });
}
