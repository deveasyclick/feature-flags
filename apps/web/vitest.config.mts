import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The dashboard's tests.
 *
 * `@/` is the app's own alias for its root, declared once here so a test can
 * import a module by the same specifier the component does.
 *
 * The environment is jsdom because the condition editor is only meaningful
 * rendered: which controls exist depends on what the reader has chosen, and
 * that is not a question a unit test over the helpers can answer.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: ["lib/**/*.test.ts", "components/**/*.test.tsx"],
  },
});
