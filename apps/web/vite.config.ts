/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const WEB_PORT = 4610;
const API_ORIGIN = "http://127.0.0.1:4611";

/**
 * The API rejects any browser Origin outside the loopback allow-list and any
 * non-loopback Host header, so the dev server proxies `/api` rather than
 * letting the browser talk to port 4611 directly.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@retr0vault/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
    },
  },
  server: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: {
      "/api": {
        target: API_ORIGIN,
        changeOrigin: true,
        headers: { origin: `http://127.0.0.1:${WEB_PORT}` },
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    target: "es2022",
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    /*
     * CSS Modules resolve to a class-name proxy instead of being compiled.
     * Nothing here asserts on computed style, and processing the real CSS
     * makes the jsdom suites markedly slower.
     */
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
