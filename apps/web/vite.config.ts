/// <reference types="vitest/config" />
import { ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, type ProxyOptions } from "vite";

const WEB_PORT = 4610;
const API_ORIGIN = "http://127.0.0.1:4611";

/**
 * The API rejects any browser Origin outside the loopback allow-list and any
 * non-loopback Host header, so both the dev server and `vite preview` proxy
 * `/api` rather than letting the browser talk to port 4611 directly.
 *
 * When the API process is not running, http-proxy fails with ECONNREFUSED and
 * Vite's default handling answers a bare 500 — indistinguishable, to the
 * browser, from the API itself having crashed. The error handler below answers
 * in the API's own envelope instead, so the app can tell "nothing is listening"
 * apart from "the API returned an error".
 */
const apiProxy: ProxyOptions = {
  target: API_ORIGIN,
  changeOrigin: true,
  headers: { origin: `http://127.0.0.1:${WEB_PORT}` },
  configure(proxy) {
    proxy.on("error", (_error, _request, target) => {
      // WebSocket upgrades hand back a raw Socket, which cannot carry a status.
      if (!(target instanceof ServerResponse)) {
        target.destroy();
        return;
      }
      if (target.headersSent) {
        target.end();
        return;
      }
      target.writeHead(503, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      target.end(
        JSON.stringify({
          error: {
            code: "UPSTREAM_UNREACHABLE",
            message:
              "The Retr0Vault API is not listening on 127.0.0.1:4611. Start it with npm run dev:api.",
            statusCode: 503,
          },
          requestId: "vite-proxy",
        }),
      );
    });
  },
};

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
    proxy: { "/api": apiProxy },
  },
  preview: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: { "/api": apiProxy },
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
