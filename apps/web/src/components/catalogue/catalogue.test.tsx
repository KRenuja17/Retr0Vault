import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";

import { CatalogueView } from "./CatalogueView";
import {
  makeCollection,
  makeDesignType,
  makeReference,
  makeStats,
  makeTag,
} from "./fixtures";

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
  referenceCount: 4,
  sortOrder: 0,
});

const DITHER_MONO = makeDesignType({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "dither-mono",
  name: "Dither Mono",
  referenceCount: 5,
  sortOrder: 1,
});

const REFERENCE_STYLES = makeCollection({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
  referenceCount: 18,
});

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designTypeId: PRINT_TECH.id,
  designDNA: "warm editorial x print DNA",
  catalogueIndex: 1,
  tags: [
    makeTag("halftone CMYK dot texture", 0),
    makeTag("warm paper ground", 1),
    makeTag("mono coordinate labels", 2),
    makeTag("wide editorial masthead", 3),
    makeTag("bone white with ember accent", 4),
    makeTag("dithered landscape plate", 5),
  ],
});

const NIGHTLIFE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Nightlife, Refined",
  analysisStatus: "pending",
  catalogueIndex: 2,
});

const UNASSIGNED = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  title: "Untitled Reference",
  catalogueIndex: 3,
});

interface RouteMap {
  readonly designTypes?: unknown;
  readonly collections?: unknown;
  readonly stats?: unknown;
  readonly references?: (page: number) => unknown;
  readonly referencesStatus?: number;
  /** Raw response for /references, for replies the API itself never sends. */
  readonly referencesResponse?: () => Response;
}

function stubApi(map: RouteMap) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/design-types")) return json(map.designTypes ?? []);
    if (url.includes("/collections")) return json(map.collections ?? []);
    if (url.includes("/stats")) return json(map.stats ?? makeStats());
    if (url.includes("/references")) {
      if (map.referencesResponse !== undefined) return map.referencesResponse();
      if (map.referencesStatus !== undefined) {
        return json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "Bad catalogue query",
              statusCode: map.referencesStatus,
            },
            requestId: "req-42",
          },
          map.referencesStatus,
        );
      }
      const page = Number(new URL(url, "http://localhost").searchParams.get("page") ?? "1");
      return json(map.references?.(page) ?? { items: [], page, limit: 24, total: 0, totalPages: 0 });
    }
    return json({}, 404);
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const onePage = (items: unknown[], total = items.length) => () => ({
  items,
  page: 1,
  limit: 24,
  total,
  totalPages: Math.ceil(total / 24),
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filter rail", () => {
  it("prints live counts from the backend and marks the active slice", async () => {
    stubApi({
      designTypes: [PRINT_TECH, DITHER_MONO],
      collections: [REFERENCE_STYLES],
      stats: makeStats({ totalReferences: 28 }),
      references: onePage([]),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    const all = await screen.findByRole("link", { name: /^all/i });
    expect(all).toHaveTextContent("28");

    const rail = screen.getByRole("navigation", { name: /catalogue filters/i });

    expect(within(rail).getByRole("link", { name: /print-tech paper/i })).toHaveTextContent("4");
    expect(within(rail).getByRole("link", { name: /dither mono/i })).toHaveAttribute(
      "href",
      "/type/dither-mono",
    );
    expect(within(rail).getByRole("link", { name: /reference styles/i })).toHaveAttribute(
      "href",
      "/collection/reference-styles",
    );
  });

  it("reports its own failure without taking down the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);
    expect(await screen.findByText(/filters unavailable/i)).toBeInTheDocument();
  });
});

describe("catalogue plates", () => {
  it("renders a reference with its DNA, first three terms and plate number", async () => {
    stubApi({
      designTypes: [PRINT_TECH],
      stats: makeStats({ totalReferences: 28 }),
      references: onePage([STILLPAGE], 28),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    const plate = await screen.findByRole("article");
    expect(within(plate).getByRole("heading", { name: "Stillpage" })).toBeInTheDocument();
    expect(within(plate).getByText("warm editorial x print DNA")).toBeInTheDocument();
    expect(within(plate).getByText("halftone CMYK dot texture")).toBeInTheDocument();
    expect(within(plate).getByText("mono coordinate labels")).toBeInTheDocument();
    // Only three terms are printed; the rest collapse into the tail.
    expect(within(plate).queryByText("bone white with ember accent")).toBeNull();
    expect(within(plate).getByText("+3")).toBeInTheDocument();
    // The design type also labels a rail tab, so this is scoped to the plate.
    expect(within(plate).getByText("Print-Tech Paper")).toBeInTheDocument();
    expect(within(plate).getByLabelText("01 of 28")).toBeInTheDocument();
  });

  it("requests the thumbnail endpoint and never the stored path or the original", async () => {
    stubApi({
      designTypes: [PRINT_TECH],
      stats: makeStats({ totalReferences: 1 }),
      references: onePage([STILLPAGE], 1),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    const image = await screen.findByAltText("Stillpage reference capture");
    expect(image).toHaveAttribute("src", `/api/v1/media/${STILLPAGE.id}/thumbnail`);
    expect(image.getAttribute("src")).not.toContain("/original");
    expect(image.getAttribute("src")).not.toContain("thumbnails/");
  });

  it("keeps a pending reference in the grid with the archive's own wording", async () => {
    stubApi({
      stats: makeStats({ totalReferences: 2 }),
      references: onePage([NIGHTLIFE], 2),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(await screen.findByRole("heading", { name: "Nightlife, Refined" })).toBeInTheDocument();
    expect(screen.getByText(/awaiting analysis/i)).toBeInTheDocument();
    expect(screen.getByLabelText("02 of 02")).toBeInTheDocument();
  });

  it("survives a reference with no design type and no metadata", async () => {
    stubApi({
      stats: makeStats({ totalReferences: 3 }),
      references: onePage([UNASSIGNED], 3),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(await screen.findByRole("heading", { name: "Untitled Reference" })).toBeInTheDocument();
    expect(screen.getByText(/unassigned/i)).toBeInTheDocument();
  });

  it("falls back to a paper plate when the thumbnail fails", async () => {
    stubApi({
      stats: makeStats({ totalReferences: 1 }),
      references: onePage([STILLPAGE], 1),
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    const image = await screen.findByAltText("Stillpage reference capture");
    fireEvent.error(image);
    expect(await screen.findByText(/image unavailable/i)).toBeInTheDocument();
  });
});

describe("catalogue states", () => {
  it("shows the empty-archive plate when nothing is stored", async () => {
    stubApi({ references: onePage([]) });
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);
    expect(
      await screen.findByRole("heading", { name: /nothing catalogued yet/i }),
    ).toBeInTheDocument();
  });

  it("distinguishes an empty design type from an empty archive", async () => {
    stubApi({ designTypes: [DITHER_MONO], references: onePage([]) });
    renderView(
      <CatalogueView filter={{ kind: "designType", slug: "dither-mono" }} label="Dither Mono" />,
    );
    expect(
      await screen.findByRole("heading", { name: /no plates under dither mono/i }),
    ).toBeInTheDocument();
  });

  it("names an unknown slug rather than pretending the slice is empty", async () => {
    stubApi({ designTypes: [DITHER_MONO], references: onePage([]) });
    renderView(
      <CatalogueView filter={{ kind: "designType", slug: "nope" }} label="nope" missing />,
    );
    expect(
      await screen.findByRole("heading", { name: /no design type called nope/i }),
    ).toBeInTheDocument();
  });

  it("reports an unreachable API and offers a retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(
      await screen.findByRole("heading", { name: /the archive is not answering/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("surfaces a structured backend error with its code", async () => {
    stubApi({ referencesStatus: 400 });
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(
      await screen.findByRole("heading", { name: /refused that request/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/VALIDATION_ERROR · 400/)).toBeInTheDocument();
  });

  it("reports a stopped API as an outage, not as a server fault", async () => {
    // Vite's default proxy handling on ECONNREFUSED: a 500 with no envelope.
    stubApi({
      referencesResponse: () =>
        new Response("Internal Server Error", {
          status: 500,
          headers: { "Content-Type": "text/plain" },
        }),
    });
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(
      await screen.findByRole("heading", { name: /the archive is not answering/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/refused that request/i)).toBeNull();
  });

  it("reports the proxy's own unreachable envelope as an outage", async () => {
    stubApi({
      referencesResponse: () =>
        new Response(
          JSON.stringify({
            error: {
              code: "UPSTREAM_UNREACHABLE",
              message: "The Retr0Vault API is not listening on 127.0.0.1:4611.",
              statusCode: 503,
            },
            requestId: "vite-proxy",
          }),
          { status: 503, headers: { "Content-Type": "application/json" } },
        ),
    });
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(
      await screen.findByRole("heading", { name: /the archive is not answering/i }),
    ).toBeInTheDocument();
  });

  it("still shows a real backend 500 as a server fault", async () => {
    stubApi({
      referencesResponse: () =>
        new Response(
          JSON.stringify({
            error: {
              code: "INTERNAL_SERVER_ERROR",
              message: "An unexpected error occurred",
              statusCode: 500,
            },
            requestId: "req-9",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
    });
    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    expect(
      await screen.findByRole("heading", { name: /refused that request/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/INTERNAL_SERVER_ERROR · 500/)).toBeInTheDocument();
    expect(screen.queryByText(/not answering/i)).toBeNull();
  });
});

describe("pagination", () => {
  it("appends the next page and keeps plate numbers continuous", async () => {
    const first = makeReference({
      id: "bbbbbbbb-0000-4000-8000-000000000001",
      title: "Plate One",
      catalogueIndex: 1,
    });
    const second = makeReference({
      id: "bbbbbbbb-0000-4000-8000-000000000002",
      title: "Plate Twenty-Five",
      catalogueIndex: 25,
    });

    stubApi({
      stats: makeStats({ totalReferences: 25 }),
      references: (page) =>
        page === 1
          ? { items: [first], page: 1, limit: 24, total: 25, totalPages: 2 }
          : { items: [second], page: 2, limit: 24, total: 25, totalPages: 2 },
    });

    renderView(<CatalogueView filter={{ kind: "all" }} label="Complete archive" />);

    const loadMore = await screen.findByRole("button", { name: /load next/i });
    expect(screen.getByText(/24 remaining/i)).toBeInTheDocument();

    await userEvent.click(loadMore);

    expect(await screen.findByRole("heading", { name: "Plate Twenty-Five" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Plate One" })).toBeInTheDocument();
    expect(screen.getByLabelText("25 of 25")).toBeInTheDocument();
    expect(screen.getByText(/end of catalogue/i)).toBeInTheDocument();
  });
});
