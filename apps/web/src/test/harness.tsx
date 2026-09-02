import type { ReactElement } from "react";
import { vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, RouterProvider, createMemoryRouter } from "react-router-dom";
import type {
  AnalysisImportReport,
  CollectionResponse,
  PendingAnalysisManifest,
  ReferenceListResponse,
  ReferenceResponse,
} from "@retr0vault/shared";

import { makeReference, makeStats } from "@/components/catalogue/fixtures";
import { routes } from "@/routes/router";

/* Test-only harness for the accession lanes and the analysis desk. */

export interface StubRequest {
  readonly method: string;
  readonly pathname: string;
  readonly search: URLSearchParams;
  /** Parsed JSON body, the FormData instance, or undefined. */
  readonly body: unknown;
}

export type StubHandler = (request: StubRequest) => unknown;

export interface StubRoute {
  readonly method?: string;
  /** Matched against the pathname after the `/api/v1` prefix. */
  readonly path: RegExp;
  readonly handler: StubHandler;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** The API's structured error envelope, as every route answers a failure. */
export function apiError(
  status: number,
  code: string,
  message: string,
): Response {
  return json(
    { error: { code, message, statusCode: status }, requestId: "req-test" },
    status,
  );
}

const DEFAULT_ROUTES: readonly StubRoute[] = [
  { path: /^\/design-types$/u, handler: () => [] },
  { path: /^\/collections$/u, handler: () => [] },
  { path: /^\/stats$/u, handler: () => makeStats() },
  {
    path: /^\/references$/u,
    handler: ({ search }) => ({
      items: [],
      page: 1,
      limit: Number(search.get("limit") ?? "24"),
      total: 0,
      totalPages: 0,
    }),
  },
];

export interface StubbedApi {
  /** Every request the app made, in order, with its parsed body. */
  readonly requests: readonly StubRequest[];
}

/**
 * Routes fetch to the supplied handlers. Handlers are tried before the
 * defaults, so a test overrides only the route it is about. A handler may
 * return a Response for a failure, or any value to be sent as a 200 JSON body.
 */
export function stubApi(routes: readonly StubRoute[] = []): StubbedApi {
  const requests: StubRequest[] = [];
  const all = [...routes, ...DEFAULT_ROUTES];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost:4610");
    const pathname = url.pathname.replace(/^\/api\/v1/u, "");
    const method = (init?.method ?? "GET").toUpperCase();

    let body: unknown;
    if (typeof FormData !== "undefined" && init?.body instanceof FormData) {
      body = init.body;
    } else if (typeof init?.body === "string") {
      body = JSON.parse(init.body) as unknown;
    }

    const request: StubRequest = { method, pathname, search: url.searchParams, body };
    requests.push(request);

    const route = all.find(
      (candidate) =>
        (candidate.method ?? "GET").toUpperCase() === method &&
        candidate.path.test(pathname),
    );
    if (route === undefined) {
      return apiError(404, "ROUTE_NOT_FOUND", `No stub for ${method} ${pathname}`);
    }

    const result = await route.handler(request);
    return result instanceof Response ? result : json(result);
  });

  vi.stubGlobal("fetch", fetchMock);
  return { requests };
}

function testQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function renderIngest(ui: ReactElement) {
  return render(
    <QueryClientProvider client={testQueryClient()}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * Renders the real route tree at `path`. The returned router is the source of
 * truth for the address, so a test can assert what a search or a closed sheet
 * did to the URL rather than inferring it from the page.
 */
export function renderRoute(path: string) {
  const router = createMemoryRouter([...routes], { initialEntries: [path] });

  return {
    ...render(
      <QueryClientProvider client={testQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
    router,
    location: () => router.state.location,
  };
}

/** One page of a reference list, shaped exactly like the backend's response. */
export function referencePage(
  items: readonly ReferenceResponse[],
  overrides: Partial<ReferenceListResponse> = {},
): ReferenceListResponse {
  const total = overrides.total ?? items.length;
  const limit = overrides.limit ?? 24;
  return {
    items: items.map((item, index) => ({ ...item, catalogueIndex: index + 1 })),
    page: 1,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    ...overrides,
  };
}

export function makeCollectionResponse(
  overrides: Partial<CollectionResponse> &
    Pick<CollectionResponse, "id" | "slug" | "name">,
): CollectionResponse {
  return {
    description: "",
    isPinned: false,
    sortOrder: 0,
    referenceCount: 0,
    ...overrides,
  };
}

export function makeFile(
  name: string,
  type: string,
  bytes = 1_024,
): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

export function makeJsonFile(name: string, payload: unknown): File {
  return new File([JSON.stringify(payload)], name, { type: "application/json" });
}

/** A file that reports an outsized length without allocating one. */
export function makeOversizeFile(name: string, size: number): File {
  const file = makeFile(name, "image/png", 8);
  Object.defineProperty(file, "size", { value: size });
  return file;
}

export function makeStoredReference(
  overrides: Partial<ReferenceResponse> & Pick<ReferenceResponse, "id" | "title">,
): ReferenceResponse {
  return makeReference(overrides);
}

export function makeManifest(
  overrides: Partial<PendingAnalysisManifest> = {},
): PendingAnalysisManifest {
  return {
    schemaVersion: 1,
    generatedAt: "2026-09-02T09:00:00.000Z",
    resultsDirectory: "D:\\Retr0Vault\\data\\analysis-results",
    analysisSchema: { type: "object" },
    designTypes: [],
    references: [],
    unavailable: [],
    ...overrides,
  };
}

export function makeImportReport(
  overrides: Partial<AnalysisImportReport> = {},
): AnalysisImportReport {
  return { imported: 0, failed: 0, results: [], ...overrides };
}
