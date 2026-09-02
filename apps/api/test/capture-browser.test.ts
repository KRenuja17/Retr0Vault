import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

import { chromium, type BrowserServer } from "playwright";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ChromiumCaptureService, type ChromiumCaptureOptions } from "../src/capture/service.js";
import { resolvePublicTarget } from "../src/capture/url-policy.js";

describe("real Chromium capture", () => {
  let fixture: Server;
  let port: number;
  let service: ChromiumCaptureService;
  let browsers: BrowserServer[];
  let privateHits: number;

  beforeEach(async () => {
    browsers = [];
    privateHits = 0;
    const html = readFileSync(fileURLToPath(new URL("./fixtures/capture/page.html", import.meta.url)), "utf8");
    fixture = createServer((request, response) => {
      if (request.url === "/hang") return;
      if (request.url === "/redirect") { response.writeHead(302, { location: `http://127.0.0.1:${port}/private` }).end(); return; }
      if (request.url === "/private") privateHits++;
      if (request.url === "/error") { response.writeHead(500).end("Error"); return; }
      response.setHeader("Content-Type", "text/html");
      response.end(request.url === "/tall" ? `${html}<div style="height:30000px"></div>` :
        request.url === "/unsafe-resource" ? `${html}<img src="http://127.0.0.1:${port}/private">` : html);
    });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const address = fixture.address();
    if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
    port = address.port;
    service = makeService();
  });

  function makeService(options: ChromiumCaptureOptions = {}) {
    return new ChromiumCaptureService({
      resolveTarget: async (url) => {
        if (url.hostname !== "capture.example.com") return resolvePublicTarget(url, async () => []);
        // Only this test dependency maps a public-shaped name to our fixture.
        // The runtime has no private-network override or resolver API input.
        return { address: "127.0.0.1", family: 4, port };
      },
      launch: async (settings) => { const browser = await chromium.launchServer(settings); browsers.push(browser); return browser; },
      ...options,
    });
  }

  afterEach(async () => {
    await service.close();
    await Promise.all(browsers.map((browser) => browser.kill().catch(() => undefined)));
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  });

  it("captures top, hero, 50%, 80% and full-page frames and closes its browser", async () => {
    const captured = await service.capture({ url: "http://capture.example.com/", fullPage: true });
    expect(captured.frames.map((frame) => frame.name)).toEqual(["viewport", "hero", "scroll-50", "scroll-80", "fullpage"]);
    const metadata = await Promise.all(captured.frames.map((frame) => sharp(frame.buffer).metadata()));
    expect(metadata.map(({ width, height }) => [width, height])).toEqual([[1440, 900], [1440, 600], [1440, 900], [1440, 900], [1440, 4800]]);
    const pixels = await Promise.all(captured.frames.slice(0, 4).map((frame) => sharp(frame.buffer).extract({ left: 0, top: 0, width: 1, height: 1 }).removeAlpha().raw().toBuffer()));
    expect(pixels.map((pixel) => [...pixel])).toEqual([[17, 34, 51], [17, 34, 51], [34, 136, 68], [34, 68, 170]]);
    expect(browsers).toHaveLength(1);
    expect(browsers[0]!.process().exitCode !== null || browsers[0]!.process().signalCode !== null).toBe(true);
  }, 30_000);

  it("blocks local subresources and omits full-page capture by default", async () => {
    const captured = await service.capture({ url: "http://capture.example.com/unsafe-resource", fullPage: false });
    expect(captured.frames.map((frame) => frame.name)).not.toContain("fullpage");
    expect(privateHits).toBe(0);
  }, 30_000);

  it.each(["redirect", "error", "tall"])("fails safely for %s and closes Chromium", async (path) => {
    await expect(service.capture({ url: `http://capture.example.com/${path}`, fullPage: true })).rejects.toMatchObject({ statusCode: expect.any(Number) });
    expect(privateHits).toBe(0);
    expect(browsers[0]!.process().exitCode !== null || browsers[0]!.process().signalCode !== null).toBe(true);
  }, 30_000);

  it("enforces the whole-capture deadline and prevents concurrent browsers", async () => {
    await service.close();
    service = makeService({ timeoutMs: 2_000 });
    const capture = service.capture({ url: "http://capture.example.com/hang", fullPage: false });
    const outcome = expect(capture).rejects.toMatchObject({ code: "CAPTURE_TIMEOUT", statusCode: 504 });
    await expect(service.capture({ url: "http://capture.example.com/", fullPage: false })).rejects.toMatchObject({ code: "CAPTURE_BUSY" });
    await outcome;
    for (const browser of browsers) expect(browser.process().exitCode !== null || browser.process().signalCode !== null).toBe(true);
  }, 15_000);
});
