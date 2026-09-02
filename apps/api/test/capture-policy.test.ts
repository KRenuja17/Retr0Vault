import { describe, expect, it, vi } from "vitest";

import { createWebsiteReferenceSchema } from "@retr0vault/shared";

import { loadConfig } from "../src/config.js";
import { ChromiumCaptureService } from "../src/capture/service.js";
import { isPublicAddress, resolvePublicTarget, validateCaptureUrl } from "../src/capture/url-policy.js";

describe("capture URL policy", () => {
  it.each([
    "file:///C:/Windows/win.ini", "data:text/html,test", "javascript:alert(1)", "ftp://example.com/a", "http://user:password@example.com/",
    "http://example.com:8080/", "http://example.com/\\file", "http://example.com/\nfile", "http://localhost/", "http://localhost./",
    "http://host.local/", "http://intranet/", "http://127.0.0.1/", "http://127.1/", "http://2130706433/", "http://0x7f000001/",
    "http://10.1.2.3/", "http://172.20.1.1/", "http://192.168.0.1/", "http://169.254.169.254/", "http://100.64.0.1/",
    "http://0.0.0.0/", "http://224.0.0.1/", "http://192.0.2.1/", "http://[::1]/", "http://[::ffff:127.0.0.1]/",
    "http://[fe80::1]/", "http://[fc00::1]/", "http://[2001:db8::1]/", "http://[2002:7f00:1::]/", "http://[64:ff9b::7f00:1]/",
  ])("rejects unsafe target %s", (value) => {
    expect(() => validateCaptureUrl(value)).toThrow();
  });

  it("accepts canonical public HTTP(S) URLs, IDNs and default ports", () => {
    expect(validateCaptureUrl("HTTPS://EXAMPLE.COM:443/a#top").href).toBe("https://example.com/a#top");
    expect(validateCaptureUrl("https://münich.example.com/").hostname).toContain("xn--");
    expect(isPublicAddress("8.8.8.8")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    expect(isPublicAddress("not-ip")).toBe(false);
  });

  it("rejects mixed public/private DNS answers and uses a validated numeric address", async () => {
    const url = new URL("https://example.com/");
    const resolver = vi.fn().mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }]);
    await expect(resolvePublicTarget(url, resolver)).rejects.toMatchObject({ code: "UNSAFE_CAPTURE_URL" });
    await expect(resolvePublicTarget(url, async () => [{ address: "8.8.8.8", family: 4 }])).resolves.toEqual({ address: "8.8.8.8", family: 4 });
    await expect(resolvePublicTarget(url, async () => [])).rejects.toMatchObject({ code: "UNSAFE_CAPTURE_URL" });
    await expect(resolvePublicTarget(url, async () => { throw new Error("ENOTFOUND"); })).rejects.toMatchObject({ code: "CAPTURE_DNS_FAILED" });
  });

  it("rejects arbitrary launch options, paths, strings for booleans and malformed API input", () => {
    for (const value of [{}, { url: "https://example.com/", fullPage: "true" }, { url: "https://example.com/", executablePath: "cmd.exe" },
      { url: "https://example.com/", storagePath: "../../outside" }, { url: "https://example.com/", script: "alert(1)" },
      { url: "https://example.com/", title: " " }, { url: "https://example.com/", designTypeId: "bad" }]) {
      expect(createWebsiteReferenceSchema.safeParse(value).success).toBe(false);
    }
    expect(createWebsiteReferenceSchema.parse({ url: "https://example.com/" }).fullPage).toBe(false);
    expect(loadConfig({}).captureTimeoutMs).toBe(45_000);
    for (const timeout of ["0", "-1", "120001", "NaN"]) expect(() => loadConfig({ CAPTURE_TIMEOUT_MS: timeout })).toThrow();
  });

  it("does not launch a browser for rejected URLs or stalled DNS", async () => {
    const launch = vi.fn();
    const service = new ChromiumCaptureService({ timeoutMs: 20, launch, resolveTarget: () => new Promise(() => undefined) });
    try {
      await expect(service.capture({ url: "file:///bad", fullPage: false })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.capture({ url: "https://example.com/", fullPage: false })).rejects.toMatchObject({ code: "CAPTURE_TIMEOUT" });
      expect(launch).not.toHaveBeenCalled();
    } finally { await service.close(); }
  });

  it("reports unavailable Chromium clearly and releases the busy slot", async () => {
    const launch = vi.fn().mockRejectedValue(new Error("Missing executable"));
    const service = new ChromiumCaptureService({ launch, resolveTarget: async () => ({ address: "8.8.8.8", family: 4 }) });
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        await expect(service.capture({ url: "https://example.com/", fullPage: false })).rejects.toMatchObject({ statusCode: 503, code: "CAPTURE_BROWSER_UNAVAILABLE" });
      }
      expect(launch).toHaveBeenCalledTimes(2);
    } finally { await service.close(); }
  });

  it("cancels pending work during shutdown and rejects future captures", async () => {
    const service = new ChromiumCaptureService({ resolveTarget: () => new Promise(() => undefined) });
    const capture = service.capture({ url: "https://example.com/", fullPage: false });
    const outcome = expect(capture).rejects.toMatchObject({ code: "CAPTURE_UNAVAILABLE" });
    await service.close();
    await outcome;
    await expect(service.capture({ url: "https://example.com/", fullPage: false })).rejects.toMatchObject({ code: "CAPTURE_UNAVAILABLE" });
  });
});
