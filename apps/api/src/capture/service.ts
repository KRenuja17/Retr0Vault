/// <reference lib="dom" />
import { chromium, type BrowserServer, type Page } from "playwright";

import type { CreateWebsiteReferenceInput, ReferenceFrame } from "@retr0vault/shared";

import { ApiError } from "../errors.js";
import { startCaptureProxy, type CaptureProxy } from "./proxy.js";
import { resolvePublicTarget, validateCaptureUrl, type ResolveCaptureTarget } from "./url-policy.js";

export const captureViewport = { width: 1440, height: 900 };
type LaunchServerOptions = NonNullable<Parameters<typeof chromium.launchServer>[0]>;
export const captureFrameNames = ["viewport", "hero", "scroll-50", "scroll-80", "fullpage"] as const;
export type CaptureFrameName = typeof captureFrameNames[number];
export interface CapturedFrame {
  readonly name: CaptureFrameName;
  readonly frameType: ReferenceFrame["frameType"];
  readonly buffer: Buffer;
}
export interface WebsiteCapture { readonly frames: CapturedFrame[] }
export interface CaptureService {
  capture(input: CreateWebsiteReferenceInput): Promise<WebsiteCapture>;
  close(): Promise<void>;
}

export interface ChromiumCaptureOptions {
  readonly timeoutMs?: number;
  readonly resolveTarget?: ResolveCaptureTarget;
  readonly launch?: (options: LaunchServerOptions) => Promise<BrowserServer>;
}

export class ChromiumCaptureService implements CaptureService {
  readonly #timeout: number;
  readonly #resolve: ResolveCaptureTarget;
  readonly #launch: (options: LaunchServerOptions) => Promise<BrowserServer>;
  #closed = false;
  #active: { abort: AbortController; promise: Promise<WebsiteCapture> } | undefined;

  constructor(options: ChromiumCaptureOptions = {}) {
    this.#timeout = options.timeoutMs ?? 45_000;
    this.#resolve = options.resolveTarget ?? resolvePublicTarget;
    this.#launch = options.launch ?? ((settings) => chromium.launchServer(settings));
  }

  async capture(input: CreateWebsiteReferenceInput): Promise<WebsiteCapture> {
    if (this.#closed) throw new ApiError(503, "CAPTURE_UNAVAILABLE", "Capture service is shutting down");
    if (this.#active) throw new ApiError(429, "CAPTURE_BUSY", "A website capture is already in progress; retry when it completes");
    const abort = new AbortController();
    const promise = this.#capture(input, abort.signal);
    this.#active = { abort, promise };
    try { return await promise; } finally { this.#active = undefined; }
  }

  async close(): Promise<void> {
    this.#closed = true;
    this.#active?.abort.abort();
    await this.#active?.promise.catch(() => undefined);
  }

  async #capture(input: CreateWebsiteReferenceInput, signal: AbortSignal): Promise<WebsiteCapture> {
    let server: BrowserServer | undefined;
    let proxy: CaptureProxy | undefined;
    let stopped = false;
    const deadline = Date.now() + this.#timeout;
    const timeoutError = new ApiError(504, "CAPTURE_TIMEOUT", "Website capture exceeded its maximum duration");
    const check = () => { if (stopped || signal.aborted || Date.now() >= deadline) throw timeoutError; };
    const remaining = () => Math.max(1, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stop: () => void = () => undefined;
    const interrupted = new Promise<never>((_resolve, reject) => {
      stop = () => { stopped = true; reject(signal.aborted ? new ApiError(503, "CAPTURE_UNAVAILABLE", "Capture was cancelled during shutdown") : timeoutError); };
      timer = setTimeout(stop, this.#timeout);
      signal.addEventListener("abort", stop, { once: true });
    });

    const work = async (): Promise<WebsiteCapture> => {
      const url = validateCaptureUrl(input.url);
      await this.#resolve(url);
      check();
      proxy = await startCaptureProxy(this.#resolve);
      if (stopped || signal.aborted) { await proxy.close(); check(); }
      try {
        server = await this.#launch({ headless: true, timeout: remaining(), chromiumSandbox: true,
          proxy: { ...proxy.settings, bypass: "<-loopback>" },
          args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp"],
        });
      } catch {
        check();
        throw new ApiError(503, "CAPTURE_BROWSER_UNAVAILABLE", "Chromium could not start; run npm run capture:install and retry");
      }
      if (stopped || signal.aborted) { await server.kill(); check(); }
      const browser = await chromium.connect(server.wsEndpoint(), { timeout: remaining() });
      check();
      const context = await browser.newContext({ viewport: captureViewport, deviceScaleFactor: 1,
        locale: "en-US", timezoneId: "UTC", colorScheme: "light", reducedMotion: "reduce",
        acceptDownloads: false, serviceWorkers: "block", permissions: [], ignoreHTTPSErrors: false,
      });
      let requests = 0;
      let blockedNavigation = false;
      await context.route("**/*", async (route) => {
        try {
          const request = route.request();
          validateCaptureUrl(request.url());
          if (++requests > 1_000 || !["GET", "HEAD"].includes(request.method())) throw new Error("Read-only capture request limit");
          await route.continue();
        } catch {
          if (route.request().isNavigationRequest()) blockedNavigation = true;
          await route.abort("blockedbyclient").catch(() => undefined);
        }
      });
      await context.routeWebSocket(/.*/, (socket) => socket.close());
      const page = await context.newPage();
      context.on("page", (popup) => { if (popup !== page) void popup.close().catch(() => undefined); });
      page.on("dialog", (dialog) => { void dialog.dismiss().catch(() => undefined); });
      page.setDefaultTimeout(Math.min(10_000, remaining()));
      page.setDefaultNavigationTimeout(Math.min(15_000, remaining()));
      const response = await page.goto(url.href, { waitUntil: "domcontentloaded" });
      if (response === null || response.status() >= 400) throw new ApiError(502, "CAPTURE_HTTP_ERROR", "Website did not return a successful page response");
      // Network-idle is bounded: streaming/analytics must not stall capture.
      await page.waitForLoadState("networkidle", { timeout: Math.min(2_000, remaining()) }).catch(() => undefined);
      check();
      await page.evaluate(() => { window.scrollTo({ top: 0, behavior: "instant" }); });
      const frames: CapturedFrame[] = [];
      const screenshot = async (name: CaptureFrameName, frameType: CapturedFrame["frameType"], options: Parameters<Page["screenshot"]>[0] = {}) => {
        check();
        const buffer = await page.screenshot({ ...options, type: "png", animations: "disabled", caret: "hide", timeout: remaining() });
        frames.push({ name, frameType, buffer });
        if (frames.reduce((total, frame) => total + frame.buffer.length, 0) > 50 * 1_024 * 1_024) {
          throw new ApiError(413, "CAPTURE_RESOURCE_LIMIT", "Captured images exceed 50 MiB");
        }
      };
      await screenshot("viewport", "viewport");
      const hero = page.locator('[data-hero], #hero, .hero, main > section:first-of-type').first();
      const box = await hero.boundingBox({ timeout: Math.min(500, remaining()) }).catch(() => null);
      if (box && box.x >= 0 && box.y >= 0 && box.width >= 100 && box.height >= 100 &&
          box.x + box.width <= captureViewport.width && box.y + box.height <= captureViewport.height) {
        await screenshot("hero", "hero", { clip: box });
      }
      for (const [name, fraction] of [["scroll-50", 0.5], ["scroll-80", 0.8]] as const) {
        check();
        await page.evaluate((ratio) => window.scrollTo({ top: Math.round(Math.max(0, document.documentElement.scrollHeight - window.innerHeight) * ratio), behavior: "instant" }), fraction);
        await page.waitForTimeout(200);
        await screenshot(name, "scroll");
      }
      if (input.fullPage) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        const dimensions = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
        if (dimensions.width > 4_096 || dimensions.height > 20_000) {
          throw new ApiError(413, "CAPTURE_PAGE_TOO_LARGE", "Full-page capture is limited to 4096 × 20000 pixels; retry without fullPage");
        }
        await screenshot("fullpage", "fullpage", { fullPage: true });
      }
      validateCaptureUrl(page.url());
      if (blockedNavigation) throw new ApiError(400, "UNSAFE_CAPTURE_URL", "Website attempted a blocked navigation");
      if (proxy.failure) throw proxy.failure;
      check();
      return { frames };
    };
    try {
      return await Promise.race([work(), interrupted]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (proxy?.failure) throw proxy.failure;
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ApiError(504, "CAPTURE_TIMEOUT", "Website navigation or screenshot timed out; no reference was saved");
      }
      throw new ApiError(502, "CAPTURE_FAILED", "Website capture failed; no reference was saved");
    } finally {
      stopped = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
      // kill owns only this capture's Chromium process tree and also terminates
      // stalled renderer/evaluate/screenshot work. No user's browser is touched.
      await Promise.all([server?.kill().catch(() => undefined), proxy?.close()]);
    }
  }
}
