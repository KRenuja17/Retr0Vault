import { randomBytes } from "node:crypto";
import { createServer, request as httpRequest, type IncomingMessage, type OutgoingHttpHeaders } from "node:http";
import { connect, type Socket } from "node:net";
import type { Duplex } from "node:stream";

import { ApiError } from "../errors.js";
import { resolvePublicTarget, type ResolveCaptureTarget } from "./url-policy.js";

export interface CaptureProxy {
  readonly settings: { server: string; username: string; password: string };
  readonly failure: Error | undefined;
  close(): Promise<void>;
}

// Chromium connects only to this short-lived, authenticated loopback proxy.
// DNS is checked here, then the upstream socket connects to that exact numeric
// address. Browser-side URL checks alone leave a DNS-rebinding gap.
export async function startCaptureProxy(resolveTarget: ResolveCaptureTarget = resolvePublicTarget): Promise<CaptureProxy> {
  const username = "capture";
  const password = randomBytes(24).toString("hex");
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const sockets = new Set<Duplex>();
  let closed = false;
  let transferred = 0;
  let connections = 0;
  let failure: Error | undefined;

  function track(socket: Socket) {
    sockets.add(socket);
    socket.on("error", () => socket.destroy());
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(15_000, () => socket.destroy());
  }

  function upstream(socket: Socket) {
    track(socket);
    socket.on("data", (chunk: Buffer) => {
      transferred += chunk.byteLength;
      if (transferred > 100 * 1_024 * 1_024) {
        failure = new ApiError(413, "CAPTURE_RESOURCE_LIMIT", "Website transfer exceeds the 100 MiB capture limit");
        for (const entry of sockets) entry.destroy();
      }
    });
  }

  function permitted(request: IncomingMessage): boolean {
    return !closed && failure === undefined && request.headers["proxy-authorization"] === authorization;
  }

  const server = createServer((request, response) => {
    if (!permitted(request)) {
      response.writeHead(407, { "Proxy-Authenticate": 'Basic realm="capture"' }).end();
      return;
    }
    void (async () => {
      const url = new URL(request.url ?? "");
      if (url.protocol !== "http:" || !["GET", "HEAD"].includes(request.method ?? "")) throw new Error("Unsupported proxy request");
      const target = await resolveTarget(url);
      if (closed || failure) { response.destroy(); return; }
      if (++connections > 1_000) throw new Error("Too many capture connections");
      const headers: OutgoingHttpHeaders = { ...request.headers, host: url.host, connection: "close" };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      const outgoing = httpRequest({ hostname: target.address, family: target.family, port: target.port ?? 80,
        path: `${url.pathname}${url.search}`, method: request.method, headers, agent: false }, (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      });
      outgoing.on("socket", upstream);
      outgoing.on("error", () => { if (!response.headersSent) response.writeHead(502); response.end(); });
      response.on("close", () => outgoing.destroy());
      outgoing.end();
    })().catch(() => { if (!response.headersSent) response.writeHead(403); response.end(); });
  });

  server.on("connect", (request, client, head) => {
    if (!permitted(request)) {
      client.end('HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="capture"\r\nContent-Length: 0\r\n\r\n');
      return;
    }
    void (async () => {
      const url = new URL(`https://${request.url ?? ""}`);
      if (url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid CONNECT target");
      const target = await resolveTarget(url);
      if (closed || failure || client.destroyed) { client.destroy(); return; }
      if (++connections > 1_000) throw new Error("Too many capture connections");
      const remote = connect({ host: target.address, family: target.family, port: target.port ?? 443 });
      upstream(remote);
      remote.once("connect", () => {
        if (closed || client.destroyed) { remote.destroy(); return; }
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length > 0) remote.write(head);
        client.pipe(remote);
        remote.pipe(client);
      });
      remote.on("error", () => client.destroy());
      remote.on("close", () => client.destroy());
      client.on("close", () => remote.destroy());
    })().catch(() => client.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n"));
  });
  server.on("connection", track);
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Capture proxy did not bind");
  return {
    settings: { server: `http://127.0.0.1:${address.port}`, username, password },
    get failure() { return failure; },
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
