import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiError,
  makeCollectionResponse,
  makeStoredReference,
  referencePage,
  renderRoute,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";
import { makeDesignType, makeStats, makeTag } from "./fixtures";

const DITHER_MONO = makeDesignType({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "dither-mono",
  name: "Dither Mono",
  referenceCount: 5,
});

const REFERENCE_STYLES = makeCollectionResponse({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
  isPinned: true,
  referenceCount: 5,
});

const HALFTONE = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designDNA: "warm editorial x print DNA",
  tags: [makeTag("halftone CMYK dot texture", 0)],
});

const OTHER = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Nightlife, Refined",
});

/** The reference list, answering on whether a query was actually sent. */
function referencesRoute(
  pages: {
    readonly matches?: (request: StubRequest) => unknown;
    readonly unsearched?: () => unknown;
  } = {},
): StubRoute {
  return {
    path: /^\/references$/u,
    handler: (request) => {
      const query = request.search.get("q");
      if (query !== null) {
        return pages.matches?.(request) ?? referencePage([HALFTONE]);
      }
      return pages.unsearched?.() ?? referencePage([HALFTONE, OTHER]);
    },
  };
}

function baseRoutes(extra: readonly StubRoute[] = []): readonly StubRoute[] {
  return [
    { path: /^\/design-types$/u, handler: () => [DITHER_MONO] },
    { path: /^\/collections$/u, handler: () => [REFERENCE_STYLES] },
    { path: /^\/stats$/u, handler: () => makeStats({ totalReferences: 8 }) },
    ...extra,
  ];
}

function listRequests(requests: readonly StubRequest[]): readonly StubRequest[] {
  return requests.filter(
    (request) => request.method === "GET" && /^\/references$/u.test(request.pathname),
  );
}

/** The most recent list request, which is the one the page is showing. */
function lastList(requests: readonly StubRequest[]): StubRequest | undefined {
  const all = listRequests(requests);
  return all[all.length - 1];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("searching the archive", () => {
  it("puts the query in the address and asks the backend to rank it", async () => {
    const api = stubApi(baseRoutes([referencesRoute()]));
    const { location } = renderRoute("/all");

    // Both plates are on the page before the search narrows them.
    await screen.findByRole("heading", { name: "Nightlife, Refined" });

    await userEvent.type(screen.getByRole("searchbox"), "halftone");
    await userEvent.click(screen.getByRole("button", { name: /^find$/i }));

    // Proof the search resolved: the unmatched plate is gone.
    await screen.findByRole("heading", { name: "Stillpage" });
    expect(screen.queryByRole("heading", { name: "Nightlife, Refined" })).toBeNull();

    expect(location().search).toBe("?q=halftone");
    const sent = lastList(api.requests);
    expect(sent?.search.get("q")).toBe("halftone");
    expect(sent?.search.get("sort")).toBe("relevance");
  });

  it("reads a query already in the address on first load", async () => {
    const api = stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/all?q=large%20serif");

    expect(await screen.findByRole("heading", { name: "Stillpage" })).toBeInTheDocument();
    expect(screen.getByRole("searchbox")).toHaveValue("large serif");
    expect(lastList(api.requests)?.search.get("q")).toBe("large serif");
  });

  it("names the query in the ledger line above the plates", async () => {
    stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/all?q=grain");

    await screen.findByRole("heading", { name: "Stillpage" });
    expect(screen.getByText(/complete archive matching/i)).toBeInTheDocument();
    expect(screen.getByText("“grain”")).toBeInTheDocument();
  });

  it("sorts by newest again once nothing is being searched for", async () => {
    const api = stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/all");

    await screen.findByRole("heading", { name: "Stillpage" });
    expect(lastList(api.requests)?.search.get("sort")).toBe("newest");
    expect(lastList(api.requests)?.search.has("q")).toBe(false);
  });
});

describe("a search that matches nothing", () => {
  it("says so without claiming the archive is empty", async () => {
    stubApi(baseRoutes([referencesRoute({ matches: () => referencePage([]) })]));
    renderRoute("/all?q=zzzz");

    expect(
      await screen.findByRole("heading", { name: /nothing in the archive matches/i }),
    ).toBeInTheDocument();
    // The empty-archive plate would tell the reader to go and add a reference.
    expect(screen.queryByText(/nothing catalogued yet/i)).toBeNull();
    expect(screen.getByRole("button", { name: /clear search/i })).toBeInTheDocument();
  });

  it("takes a suggested term straight into the address", async () => {
    stubApi(
      baseRoutes([
        referencesRoute({
          matches: (request) =>
            request.search.get("q") === "halftone"
              ? referencePage([HALFTONE])
              : referencePage([]),
        }),
      ]),
    );
    const { location } = renderRoute("/all?q=zzzz");

    await screen.findByRole("heading", { name: /nothing in the archive matches/i });
    await userEvent.click(screen.getByRole("button", { name: "halftone" }));

    expect(await screen.findByRole("heading", { name: "Stillpage" })).toBeInTheDocument();
    expect(location().search).toBe("?q=halftone");
  });
});

describe("clearing a search", () => {
  it("drops the query from the address and shows the whole slice again", async () => {
    stubApi(baseRoutes([referencesRoute()]));
    const { location } = renderRoute("/all?q=halftone");

    await screen.findByRole("heading", { name: "Stillpage" });
    expect(screen.queryByRole("heading", { name: "Nightlife, Refined" })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: /^clear$/i }));

    // The unsearched page carries a plate the search did not match.
    expect(
      await screen.findByRole("heading", { name: "Nightlife, Refined" }),
    ).toBeInTheDocument();
    expect(location().search).toBe("");
  });

  it("offers no clear control when nothing is being searched for", async () => {
    stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/all");

    await screen.findByRole("heading", { name: "Stillpage" });
    expect(screen.queryByRole("button", { name: /^clear$/i })).toBeNull();
  });
});

describe("searching inside a slice", () => {
  it("sends the design type and the query together", async () => {
    const api = stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/type/dither-mono?q=grain");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sent = lastList(api.requests);
    expect(sent?.search.get("designType")).toBe("dither-mono");
    expect(sent?.search.get("q")).toBe("grain");
  });

  it("keeps the slice's tab active while a search narrows it", async () => {
    stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/type/dither-mono?q=grain");

    await screen.findByRole("heading", { name: "Stillpage" });
    const rail = screen.getByRole("navigation", { name: /catalogue filters/i });
    expect(
      within(rail).getByRole("link", { name: /dither mono/i }),
    ).toHaveAttribute("aria-current", "page");
  });

  it("sends the collection and the query together", async () => {
    const api = stubApi(baseRoutes([referencesRoute()]));
    renderRoute("/collection/reference-styles?q=orange");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sent = lastList(api.requests);
    expect(sent?.search.get("collection")).toBe("reference-styles");
    expect(sent?.search.get("q")).toBe("orange");
  });

  it("offers the whole archive when a slice search finds nothing", async () => {
    stubApi(baseRoutes([referencesRoute({ matches: () => referencePage([]) })]));
    renderRoute("/type/dither-mono?q=zzzz");

    await screen.findByRole("heading", { name: /nothing in the archive matches/i });
    expect(
      screen.getByRole("link", { name: /search the whole archive/i }),
    ).toHaveAttribute("href", "/all?q=zzzz");
  });
});

describe("paging through search results", () => {
  it("carries the query onto the next page", async () => {
    const second = makeStoredReference({
      id: "aaaaaaaa-0000-4000-8000-000000000003",
      title: "Halftone Sails",
    });
    const api = stubApi(
      baseRoutes([
        {
          path: /^\/references$/u,
          handler: ({ search }) =>
            search.get("page") === "2"
              ? referencePage([second], { page: 2, total: 25, totalPages: 2 })
              : referencePage([HALFTONE], { total: 25, totalPages: 2 }),
        },
      ]),
    );
    renderRoute("/all?q=halftone");

    await screen.findByRole("heading", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /load next/i }));

    expect(
      await screen.findByRole("heading", { name: "Halftone Sails" }),
    ).toBeInTheDocument();
    const paged = listRequests(api.requests).filter(
      (request) => request.search.get("page") === "2",
    );
    expect(paged).toHaveLength(1);
    expect(paged[0]?.search.get("q")).toBe("halftone");
  });
});

describe("when the archive cannot answer a search", () => {
  it("reports an unreachable API and offers a retry", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderRoute("/all?q=halftone");

    expect(
      await screen.findByRole("heading", { name: /the archive is not answering/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });

  it("surfaces a rejected query with the backend's own code", async () => {
    stubApi(
      baseRoutes([
        {
          path: /^\/references$/u,
          handler: () => apiError(400, "VALIDATION_ERROR", "q: Too long"),
        },
      ]),
    );
    renderRoute("/all?q=halftone");

    expect(
      await screen.findByRole("heading", { name: /refused that request/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/VALIDATION_ERROR · 400/)).toBeInTheDocument();
  });
});
