import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeDesignType, makeStats } from "@/components/catalogue/fixtures";
import {
  makeCollectionResponse,
  makeStoredReference,
  referencePage,
  renderRoute,
  stubApi,
  type StubRoute,
} from "@/test/harness";

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
  referenceCount: 5,
});

const STILLPAGE = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designThesis: "A thesis.",
  imageRecipe: "[SUBJECT] on warm paper.",
});

function baseRoutes(): readonly StubRoute[] {
  return [
    { path: /^\/design-types$/u, handler: () => [DITHER_MONO] },
    { path: /^\/collections$/u, handler: () => [REFERENCE_STYLES] },
    { path: /^\/stats$/u, handler: () => makeStats({ totalReferences: 5 }) },
    { path: /^\/references$/u, handler: () => referencePage([STILLPAGE], { total: 5 }) },
    { path: /^\/references\/[^/]+$/u, handler: () => STILLPAGE },
  ];
}

/** The plate's own title link, which is the catalogue's single tab stop. */
function plateLink() {
  return screen.getAllByRole("link", { name: "Stillpage" })[0]!;
}

/** Waits for the reference sheet, proven by content only it renders. */
async function openSheet() {
  await userEvent.click(plateLink());
  await screen.findByRole("dialog");
  return screen.getByRole("dialog");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a reference from a search", () => {
  it("returns to the same search when the sheet is closed", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute("/all?q=halftone");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    expect(location().pathname).toBe(`/reference/${STILLPAGE.id}`);

    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(location().search).toBe("?q=halftone");
  });

  it("still has the query in the field after the sheet is closed", async () => {
    stubApi(baseRoutes());
    renderRoute("/all?q=halftone");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    /*
     * While the sheet is open the catalogue behind it is aria-hidden, so the
     * field is deliberately unreachable. What matters is that the search is
     * still there to come back to.
     */
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    expect(await screen.findByRole("searchbox")).toHaveValue("halftone");
  });

  it("returns to the search even when the sheet was opened directly", async () => {
    stubApi(baseRoutes());
    // A pasted address: no history to go back to, so the origin is used.
    const { location } = renderRoute("/all?q=grain");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(location().search).toBe("?q=grain"));
  });
});

describe("opening a reference from a slice", () => {
  it("returns to the same collection", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute("/collection/reference-styles");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    await waitFor(() =>
      expect(location().pathname).toBe("/collection/reference-styles"),
    );
  });

  it("returns to the same design type", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute("/type/dither-mono");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(location().pathname).toBe("/type/dither-mono"));
  });

  it("falls back to the whole archive for an address pasted straight in", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute(`/reference/${STILLPAGE.id}`);

    const sheet = await screen.findByRole("dialog");
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(location().search).toBe("");
  });
});

describe("focus after a sheet closes", () => {
  it("hands focus back to the plate the reader opened", async () => {
    stubApi(baseRoutes());
    renderRoute("/all?q=halftone");

    await screen.findByRole("heading", { name: "Stillpage" });
    const sheet = await openSheet();
    await userEvent.click(within(sheet).getByRole("button", { name: /^close$/i }));

    // The plate remounts behind the sheet and claims focus back.
    await waitFor(() => expect(plateLink()).toHaveFocus());
  });
});

describe("pinned collection navigation", () => {
  it("reaches the collection from the filter rail", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute("/all");

    /*
     * The rail element exists while it is still loading, so this waits on the
     * tab itself — it cannot be rendered before the collection list resolves.
     */
    const tab = await screen.findByRole("link", { name: /reference styles/i });
    expect(tab).toHaveTextContent("5");

    await userEvent.click(tab);

    // The collection header only renders once the collection list resolved.
    expect(
      await screen.findByRole("heading", { name: "Reference Styles" }),
    ).toBeInTheDocument();
    expect(location().pathname).toBe("/collection/reference-styles");
  });

  it("reaches the register from the rail, for collections that are not pinned", async () => {
    stubApi(baseRoutes());
    const { location } = renderRoute("/all");

    await userEvent.click(
      await screen.findByRole("link", { name: /^collections$/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /curated groupings/i }),
    ).toBeInTheDocument();
    expect(location().pathname).toBe("/collections");
  });
});
