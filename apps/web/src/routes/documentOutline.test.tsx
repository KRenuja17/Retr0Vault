import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";

import { makeDesignType, makeStats } from "@/components/catalogue/fixtures";
import {
  makeCollectionResponse,
  makeStoredReference,
  referencePage,
  renderRoute,
  stubApi,
  type StubRoute,
} from "@/test/harness";

/*
 * The document outline, route by route. Every page needs exactly one h1 and no
 * skipped level below it — and, because the archive prints some of its titles
 * only for screen readers, it must never announce the same slice twice under
 * two headings carrying the same name.
 */

const DITHER_MONO = makeDesignType({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "dither-mono",
  name: "Dither Mono",
  referenceCount: 2,
});

const REFERENCE_STYLES = makeCollectionResponse({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
  isPinned: true,
  referenceCount: 2,
});

const STILLPAGE = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
});

function baseRoutes(): readonly StubRoute[] {
  return [
    { path: /^\/design-types$/u, handler: () => [DITHER_MONO] },
    { path: /^\/collections$/u, handler: () => [REFERENCE_STYLES] },
    { path: /^\/stats$/u, handler: () => makeStats({ totalReferences: 2 }) },
    {
      path: /^\/references$/u,
      handler: () => referencePage([STILLPAGE], { total: 1 }),
    },
    { path: /^\/references\/[^/]+$/u, handler: () => STILLPAGE },
  ];
}

/** Headings in document order, ignoring anything hidden from the tree. */
function outline(): ReadonlyArray<{ level: number; name: string }> {
  return [...document.querySelectorAll("h1, h2, h3, h4, h5, h6")]
    .filter((heading) => heading.closest("[aria-hidden='true']") === null)
    .map((heading) => ({
      level: Number(heading.tagName.slice(1)),
      name: (heading.textContent ?? "").trim(),
    }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("document outline", () => {
  /*
   * Each route waits on something only it renders once its data has come back
   * — a plate title, a style-guide heading — never on a container that exists
   * before the request resolves.
   */
  const cases: ReadonlyArray<[route: string, settle: () => Promise<unknown>]> = [
    ["/all", () => screen.findByRole("link", { name: "Stillpage" })],
    ["/all?q=grain", () => screen.findByRole("link", { name: "Stillpage" })],
    [
      "/type/dither-mono",
      () => screen.findByRole("heading", { level: 1, name: /dither mono/i }),
    ],
    [
      "/collection/reference-styles",
      () => screen.findByRole("heading", { level: 1, name: /reference styles/i }),
    ],
    ["/collections", () => screen.findByText(/pinned collections lead/i)],
    ["/add", () => screen.findByRole("heading", { name: /file an image reference/i })],
    ["/compare", () => screen.findByText(/needs at least/)],
    ["/direction", () => screen.findByText(/needs at least/)],
    ["/nowhere-at-all", () => screen.findByText(/No such plate/)],
  ];

  for (const [route, settle] of cases) {
    it(`gives ${route} exactly one h1 and no skipped level`, async () => {
      stubApi(baseRoutes());
      renderRoute(route);

      await settle();

      const headings = outline();
      const firsts = headings.filter((heading) => heading.level === 1);
      expect(firsts, `h1s on ${route}: ${JSON.stringify(headings)}`).toHaveLength(1);

      let previous = 0;
      for (const heading of headings) {
        if (previous !== 0) {
          expect(
            heading.level,
            `${route} skips from h${previous} to h${heading.level} at "${heading.name}"`,
          ).toBeLessThanOrEqual(previous + 1);
        }
        previous = heading.level;
      }
    });
  }

  it("lets the design-type guide own the only h1, rather than repeating the name", async () => {
    stubApi(baseRoutes());
    renderRoute("/type/dither-mono");

    await screen.findByRole("heading", { level: 1, name: /dither mono/i });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("lets the collection header own the only h1, rather than repeating the name", async () => {
    stubApi(baseRoutes());
    renderRoute("/collection/reference-styles");

    await screen.findByRole("heading", { level: 1, name: /reference styles/i });
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  it("carries the slice name for screen readers where the catalogue prints no title", async () => {
    stubApi(baseRoutes());
    renderRoute("/all");

    const heading = await screen.findByRole("heading", {
      level: 1,
      name: "Complete archive",
    });
    expect(heading).toHaveClass("rv-visually-hidden");
  });

  it("keeps one h1 while the design type is still being read", async () => {
    stubApi([
      // The list never resolves, so the guide cannot supply a heading yet.
      { path: /^\/design-types$/u, handler: () => new Promise(() => {}) },
      ...baseRoutes(),
    ]);
    renderRoute("/type/dither-mono");

    await waitFor(() =>
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1),
    );
  });
});
