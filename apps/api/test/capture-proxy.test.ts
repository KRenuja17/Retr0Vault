import { createServer, request, type IncomingHttpHeaders, type Server } from "node:http";
import { connect } from "node:net";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startCaptureProxy, type CaptureProxy } from "../src/capture/proxy.js";
import { resolvePublicTarget, validateCaptureUrl } from "../src/capture/url-policy.js";

describe("capture network proxy", () => {
  let fixture: Server;
  let proxy: CaptureProxy;
  let port: number;
  let upstreamHeaders: IncomingHttpHeaders[];

  beforeEach(async () => {
    upstreamHeaders = [];
    fixture = createServer((request, response) => { upstreamHeaders.push(request.headers); response.end("fixture"); });
    await new Promise<void>((resolve) => fixture.listen(0, "127.0.0.1", resolve));
    const address = fixture.address();
    if (address === null || typeof address === "string") throw new Error("Fixture did not bind");
    port = address.port;
    proxy = await startCaptureProxy(async (url) => {
      validateCaptureUrl(url.href);
      return { address: "127.0.0.1", family: 4, port };
    });
  });

  afterEach(async () => {
    await proxy.close();
    fixture.closeAllConnections();
    await new Promise<void>((resolve) => fixture.close(() => resolve()));
  });

  function authorization() {
    return `Basic ${Buffer.from(`${proxy.settings.username}:${proxy.settings.password}`).toString("base64")}`;
  }

  function get(url = "http://capture.example.com/", authenticated = true) {
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const requestUrl = new URL(proxy.settings.server);
      const outgoing = request({ hostname: requestUrl.hostname, port: requestUrl.port, path: url,
        headers: authenticated ? { "proxy-authorization": authorization() } : {},
      }, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => { body += chunk; });
        response.on("end", () => resolve({ status: response.statusCode!, body }));
        response.on("error", reject);
      });
      outgoing.on("error", reject);
      outgoing.end();
    });
  }

  it("requires authentication and connects to the resolved numeric address while preserving Host", async () => {
    expect((await get("http://capture.example.com/", false)).status).toBe(407);
    expect(upstreamHeaders).toHaveLength(0);
    expect(await get()).toEqual({ status: 200, body: "fixture" });
    expect(upstreamHeaders[0]?.host).toBe("capture.example.com");
    expect(upstreamHeaders[0]).not.toHaveProperty("proxy-authorization");
    expect((await get("http://127.0.0.1/")).status).toBe(403);
    expect(upstreamHeaders).toHaveLength(1);
  });

  it("revalidates DNS for new connections and rejects a rebound private address", async () => {
    await proxy.close();
    const dns = vi.fn().mockResolvedValueOnce([{ address: "8.8.8.8", family: 4 }])
      .mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
    proxy = await startCaptureProxy(async (url) => {
      await resolvePublicTarget(url, dns);
      return { address: "127.0.0.1", family: 4, port };
    });
    expect((await get()).status).toBe(200);
    expect((await get()).status).toBe(403);
    expect(dns).toHaveBeenCalledTimes(2);
    expect(upstreamHeaders).toHaveLength(1);
  });

  it("pins HTTPS CONNECT tunnels and blocks unsafe CONNECT targets", async () => {
    const tunnel = (target: string, sendRequest: boolean) => new Promise<string>((resolve, reject) => {
      const endpoint = new URL(proxy.settings.server);
      const socket = connect({ host: endpoint.hostname, port: Number(endpoint.port) });
      let content = "";
      let sent = false;
      socket.setEncoding("utf8");
      socket.on("error", reject);
      socket.setTimeout(3_000, () => { socket.destroy(); reject(new Error("Tunnel timed out")); });
      socket.on("connect", () => socket.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\nProxy-Authorization: ${authorization()}\r\n\r\n`));
      socket.on("data", (chunk: string) => {
        content += chunk;
        if (!sent && sendRequest && content.includes("200 Connection Established")) {
          sent = true;
          // The test fixture is HTTP; production tunnels forward TLS bytes unchanged.
          socket.write("GET / HTTP/1.1\r\nHost: capture.example.com\r\nConnection: close\r\n\r\n");
        }
      });
      socket.on("close", () => resolve(content));
    });
    expect(await tunnel("capture.example.com:443", true)).toContain("fixture");
    expect(await tunnel("127.0.0.1:443", false)).toContain("403 Forbidden");
    expect(await tunnel("capture.example.com:22", false)).toContain("403 Forbidden");
    expect(upstreamHeaders).toHaveLength(1);
  });

  it("does not open a late upstream socket after proxy cleanup", async () => {
    await proxy.close();
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const resolving = new Promise<void>((resolve) => { entered = resolve; });
    proxy = await startCaptureProxy(async () => {
      entered?.();
      await new Promise<void>((resolve) => { release = resolve; });
      return { address: "127.0.0.1", family: 4, port };
    });
    const pending = get().catch(() => undefined);
    await resolving;
    await proxy.close();
    release?.();
    await pending;
    expect(upstreamHeaders).toHaveLength(0);
  });
});
