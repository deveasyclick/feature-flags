import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The dashboard's unit tests.
 *
 * `@/` is the app's own alias for its root, declared once here so a test can
 * import a module by the same specifier the component does.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["lib/**/*.test.ts"],
  },
});
