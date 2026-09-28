import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@retr0vault/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    passWithNoTests: false,
    restoreMocks: true,
    // Each worker holds an in-process Postgres (PGlite, WebAssembly, ~0.5 GB):
    // a few roomy workers finish sooner, and more safely, than many starved ones.
    maxWorkers: 6,
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
