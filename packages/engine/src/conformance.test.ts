import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildConformance } from "./conformance.js";

const CORPUS_URL = new URL(
  "../../../sdks/fixtures/conformance.json",
  import.meta.url,
);

function committed(): unknown {
  return JSON.parse(readFileSync(CORPUS_URL, "utf8")) as unknown;
}

describe("conformance corpus", () => {
  it("is what the reference engine generates today", () => {
    // Regenerate with `pnpm --filter @iwifunni/engine fixtures`. A failure here
    // means the algorithm moved and every SDK's fixture test has to be run.
    expect(committed()).toEqual(buildConformance());
  });

  it("covers every reason the engine serves", () => {
    const corpus = committed() as {
      snapshot: Array<{ expect: { reason: string } }>;
    };
    const reasons = new Set(
      corpus.snapshot.map((entry) => entry.expect.reason),
    );

    expect([...reasons].sort()).toEqual([
      "default_variation",
      "flag_archived",
      "flag_disabled",
      "flag_not_found",
      "percentage_rollout",
      "segment",
      "targeting_rule",
    ]);
  });
});
