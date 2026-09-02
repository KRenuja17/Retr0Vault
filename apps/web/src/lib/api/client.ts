import type { ErrorResponse } from "@retr0vault/shared";

/**
 * The API binds to 127.0.0.1:4611 and rejects any browser Origin outside its
 * loopback allow-list, so the browser always talks to a same-origin `/api/v1`
 * path that Vite proxies. `VITE_API_BASE_URL` overrides it for other hosts.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_BASE_URL ?? "/api/v1";

export class ApiError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: {
      readonly code: string;
      readonly statusCode: number;
      readonly requestId?: string | undefined;
      readonly cause?: unknown;
    },
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = options.code;
    this.statusCode = options.statusCode;
    this.requestId = options.requestId;
  }

  /**
   * True when the API process could not be reached at all, as opposed to
   * reached and answering with an error. Covers a failed fetch, and a proxy or
   * gateway that could not connect to the API behind it.
   */
  get isOffline(): boolean {
    return (
      this.code === "NETWORK_UNREACHABLE" || this.code === "UPSTREAM_UNREACHABLE"
    );
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { error?: unknown };
  if (typeof candidate.error !== "object" || candidate.error === null) {
    return false;
  }
  const error = candidate.error as { code?: unknown; message?: unknown };
  return typeof error.code === "string" && typeof error.message === "string";
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  /** Serialised as JSON unless a FormData body is supplied. */
  readonly body?: unknown;
  readonly searchParams?: Readonly<Record<string, string | number | boolean | undefined>>;
}

function buildUrl(
  path: string,
  searchParams: ApiRequestOptions["searchParams"],
): string {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  const url = `${API_BASE_URL}${normalisedPath}`;
  if (!searchParams) {
    return url;
  }

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  const serialised = query.toString();
  return serialised.length > 0 ? `${url}?${serialised}` : url;
}

/**
 * Single fetch entry point. Every failure — transport, HTTP, or malformed
 * payload — surfaces as an ApiError so views can render one error treatment.
 */
export async function apiRequest<TResponse>(
  path: string,
  { body, searchParams, headers, ...init }: ApiRequestOptions = {},
): Promise<TResponse> {
  const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
  const requestInit: RequestInit = {
    ...init,
    headers: {
      Accept: "application/json",
      ...(body !== undefined && !isFormData
        ? { "Content-Type": "application/json" }
        : {}),
      ...headers,
    },
  };

  if (body !== undefined) {
    requestInit.body = isFormData ? (body as FormData) : JSON.stringify(body);
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, searchParams), requestInit);
  } catch (cause) {
    throw new ApiError(
      "Retr0Vault could not reach the local API on 127.0.0.1:4611.",
      { code: "NETWORK_UNREACHABLE", statusCode: 0, cause },
    );
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  const raw = await response.text();
  let payload: unknown;
  let parseFailure: unknown;

  if (raw.length > 0) {
    try {
      payload = JSON.parse(raw) as unknown;
    } catch (cause) {
      /*
       * Deliberately not thrown here. An unparseable body on a FAILED response
       * is evidence about who answered — a proxy that could not connect sends
       * plain text or nothing — so it is classified below with the status.
       * Only an unparseable body on a SUCCESSFUL response is a broken contract.
       */
      parseFailure = cause;
    }
  }

  if (!response.ok) {
    if (isErrorResponse(payload)) {
      throw new ApiError(payload.error.message, {
        code: payload.error.code,
        statusCode: payload.error.statusCode,
        requestId: payload.requestId,
      });
    }

    /*
     * The API answers every error — 500s included — with the structured
     * envelope above. So a 5xx that arrives WITHOUT one did not come from the
     * API: it came from something in front of it that could not connect, such
     * as the Vite dev proxy answering 500 on ECONNREFUSED. Report that as
     * unreachable rather than as a server fault, which would send the reader
     * looking for a bug in a process that is not even running.
     *
     * A genuine backend 500 still carries the envelope and is never masked.
     */
    if (response.status >= 500) {
      throw new ApiError(
        "Retr0Vault could not reach the local API on 127.0.0.1:4611.",
        { code: "UPSTREAM_UNREACHABLE", statusCode: response.status },
      );
    }

    throw new ApiError(`Request failed with status ${response.status}.`, {
      code: "REQUEST_FAILED",
      statusCode: response.status,
    });
  }

  if (parseFailure !== undefined) {
    throw new ApiError("The API returned a response that was not JSON.", {
      code: "INVALID_RESPONSE",
      statusCode: response.status,
      cause: parseFailure,
    });
  }

  return payload as TResponse;
}
