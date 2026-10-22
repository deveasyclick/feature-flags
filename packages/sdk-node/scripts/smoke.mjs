import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDir = resolve(packageDir, "dist");
const packed = JSON.parse(execFileSync("npm", ["pack", "--json"], { cwd: outputDir, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }));
const filename = packed[0]?.filename;
if (!filename || filename.includes("/") || filename.includes("\\")) throw new Error("Invalid package filename.");
const consumerDir = await mkdtemp(resolve(tmpdir(), "iwifunni-sdk-smoke-"));
try {
  await writeFile(resolve(consumerDir, "package.json"), JSON.stringify({ private: true, type: "module" }));
  execFileSync("npm", ["install", resolve(outputDir, filename), "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: consumerDir, stdio: "inherit" });
  const manifest = JSON.parse(await readFile(resolve(consumerDir, "node_modules/@iwifunni-flag/core/package.json"), "utf8"));
  if (Object.keys(manifest.dependencies ?? {}).some((name) => name.startsWith("@iwifunni/"))) throw new Error("The published package depends on unpublished workspace packages.");
  await writeFile(resolve(consumerDir, "index.mjs"), `import { FeatureFlags } from "@iwifunni-flag/core";
const config = { version: "smoke", project: { key: "test", name: "Test" }, environment: { key: "dev", name: "Dev" }, flags: [], segments: [] };
const client = new FeatureFlags({ sdkKey: "fixture", refreshIntervalMs: 0, fetch: async () => new Response(JSON.stringify(config)) });
await client.initialize();
if (client.getBoolean("missing", false) !== false || client.config?.version !== "smoke") throw new Error("SDK smoke test failed.");
client.close();
`);
  execFileSync(process.execPath, ["index.mjs"], { cwd: consumerDir, stdio: "inherit" });
  await writeFile(resolve(consumerDir, "index.mts"), `import { FeatureFlags, type FeatureFlagsOptions, type FlagDecision } from "@iwifunni-flag/core";
const options: FeatureFlagsOptions = { sdkKey: "fixture", streaming: true };
const flags = new FeatureFlags(options);
const decision: FlagDecision = flags.evaluate("test");
flags.trackOutcome(decision, true);
const value: boolean = flags.getBoolean("test", false);
void value;
flags.close();
`);
  execFileSync(process.execPath, [resolve(packageDir, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "--types", "node", "--typeRoots", resolve(packageDir, "node_modules/@types"), "index.mts"], { cwd: consumerDir, stdio: "inherit" });
  console.info(`Verified standalone runtime and TypeScript consumer: ${filename}`);
} finally {
  if (dirname(consumerDir) !== tmpdir()) throw new Error("Invalid smoke-test directory.");
  await rm(consumerDir, { recursive: true, force: true });
}
