import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "./client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("returns the parsed payload for a successful read", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ status: "ok", service: "retr0vault-api" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(apiRequest("/health")).resolves.toEqual({
      status: "ok",
      service: "retr0vault-api",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/health",
      expect.objectContaining({ headers: expect.objectContaining({ Accept: "application/json" }) }),
    );
  });

  it("serialises search params and drops undefined values", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest("/references", {
      searchParams: { designType: "dither-mono", page: 2, q: undefined },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/api/v1/references?designType=dither-mono&page=2",
    );
  });

  it("translates the backend error envelope into an ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "DESIGN_TYPE_NOT_FOUND",
              message: "Design type not found",
              statusCode: 404,
            },
            requestId: "req-7",
          },
          404,
        ),
      ),
    );

    const error = await apiRequest("/design-types/nope").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    const apiError = error as ApiError;
    expect(apiError.code).toBe("DESIGN_TYPE_NOT_FOUND");
    expect(apiError.statusCode).toBe(404);
    expect(apiError.requestId).toBe("req-7");
    expect(apiError.isOffline).toBe(false);
  });

  it("reports an unreachable API rather than throwing a raw TypeError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));

    const error = await apiRequest("/health").catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).isOffline).toBe(true);
  });

  it("keeps a genuine backend 500 as a server error, not an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "An unexpected error occurred",
              statusCode: 500,
            },
            requestId: "req-9",
          },
          500,
        ),
      ),
    );

    const error = (await apiRequest("/references").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.statusCode).toBe(500);
    // The API answered. Reporting this as offline would hide a real fault.
    expect(error.isOffline).toBe(false);
  });

  it("reads an envelope-less 5xx as the proxy failing to reach the API", async () => {
    // What Vite's default proxy error handling produces on ECONNREFUSED.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const error = (await apiRequest("/references").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("UPSTREAM_UNREACHABLE");
    expect(error.isOffline).toBe(true);
  });

  it("honours the proxy's own unreachable envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: "UPSTREAM_UNREACHABLE",
              message: "The Retr0Vault API is not listening on 127.0.0.1:4611.",
              statusCode: 503,
            },
            requestId: "vite-proxy",
          },
          503,
        ),
      ),
    );

    const error = (await apiRequest("/references").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("UPSTREAM_UNREACHABLE");
    expect(error.isOffline).toBe(true);
  });

  it("does not treat an envelope-less 4xx as an outage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Not Found", { status: 404 })),
    );

    const error = (await apiRequest("/nope").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("REQUEST_FAILED");
    expect(error.isOffline).toBe(false);
  });

  it("still rejects a non-JSON body on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<!doctype html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      ),
    );

    const error = (await apiRequest("/health").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.isOffline).toBe(false);
  });

  it("classifies an empty-bodied 500, which is what Vite actually sends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
    );

    const error = (await apiRequest("/references").catch((cause: unknown) => cause)) as ApiError;
    expect(error.code).toBe("UPSTREAM_UNREACHABLE");
    expect(error.isOffline).toBe(true);
  });

  it("treats a 204 as an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    await expect(apiRequest("/references/x")).resolves.toBeUndefined();
  });
});
