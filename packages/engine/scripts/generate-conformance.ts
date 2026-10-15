import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildConformance } from "../src/conformance.js";

/**
 * Writes the conformance corpus every SDK is tested against.
 *
 * Run with `pnpm --filter @iwifunni/engine fixtures` after changing the engine:
 * the generated file is committed, and the engine's own test fails while it is
 * out of date, so the other languages cannot be left behind silently.
 */
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(here, "../../../sdks/fixtures/conformance.json");

mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, `${JSON.stringify(buildConformance(), null, 2)}\n`);

console.log(`[engine] wrote ${target}`);
