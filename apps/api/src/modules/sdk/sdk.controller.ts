import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { setTimeout as delay } from "node:timers/promises";
import { clientEvaluateRequestSchema } from "@iwifunni/contracts";
import { ApiError } from "../../shared/http/errors.js";

import { requireApiKey, type ApiKeyEnv } from "../../middleware/api-key.js";
import type { SdkService } from "./sdk.service.js";
import {
  SDK_CONFIG_CACHE_CONTROL,
  SDK_STREAM_INTERVAL_MS,
  SDK_STREAM_MAX_AGE_MS,
} from "./sdk.types.js";

/** `W/"abc"` and `"abc"` address the same entity, so both are accepted. */
function ifNoneMatch(header: string | undefined): string | null {
  if (!header) return null;

  return header.trim().replace(/^W\//i, "").replace(/^"|"$/g, "");
}

export class SdkController {
  constructor(private readonly service: SdkService) {}

  async stream(c: Context<ApiKeyEnv>): Promise<Response> {
    const access = requireApiKey(c);
    const initial = await this.service.load(access);
    const release = this.service.openStream(access);
    const secret =
      c.req.header("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      const cancel = () => {
        abort.abort();
        stream.abort();
        release();
      };
      stream.onAbort(() => {
        abort.abort();
        release();
      });
      c.req.raw.signal.addEventListener("abort", cancel, { once: true });
      const timeout = setTimeout(cancel, SDK_STREAM_MAX_AGE_MS);
      timeout.unref();
      let version = initial.version;
      try {
        if (c.req.raw.signal.aborted) {
          cancel();
          return;
        }
        await stream.writeSSE({
          event: "configuration",
          data: JSON.stringify({ version }),
          id: version,
        });
        while (!abort.signal.aborted) {
          await delay(SDK_STREAM_INTERVAL_MS, undefined, {
            signal: abort.signal,
          });
          const next = await this.service.streamVersion(secret);
          if (next !== version) {
            version = next;
            await stream.writeSSE({
              event: "configuration",
              data: JSON.stringify({ version }),
              id: version,
            });
          } else await stream.writeSSE({ event: "heartbeat", data: "{}" });
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          if (
            error instanceof ApiError &&
            (error.status === 401 ||
              error.status === 403 ||
              error.status === 404)
          )
            await stream.writeSSE({ event: "revoked", data: "{}" });
          else await stream.writeSSE({ event: "reconnect", data: "{}" });
        }
      } finally {
        clearTimeout(timeout);
        c.req.raw.signal.removeEventListener("abort", cancel);
        release();
      }
    });
  }

  async evaluateClient(c: Context<ApiKeyEnv>): Promise<Response> {
    let body: unknown;
    try {
      body = await c.req.json<unknown>();
    } catch {
      throw ApiError.badRequest("Invalid JSON body.");
    }
    const parsed = clientEvaluateRequestSchema.safeParse(body);
    if (!parsed.success)
      throw ApiError.badRequest(
        parsed.error.issues[0]?.message ?? "Invalid evaluation request.",
      );
    c.header("Cache-Control", "no-store");
    return c.json(
      await this.service.evaluateClient(requireApiKey(c), parsed.data),
    );
  }

  async config(c: Context<ApiKeyEnv>): Promise<Response> {
    const access = requireApiKey(c);
    const config = await this.service.load(access);
    const etag = `"${config.version}"`;
    const headers = {
      ETag: etag,
      "Cache-Control": SDK_CONFIG_CACHE_CONTROL,
    };

    // Nothing changed since the client's last fetch, so nothing is sent. The
    // SDK keeps evaluating from the snapshot it already has.
    if (ifNoneMatch(c.req.header("if-none-match")) === config.version) {
      return c.body(null, 304, headers);
    }

    return c.json(config, 200, headers);
  }
}
