import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { makeDesignType, makeReference, makeStats } from "@/components/catalogue/fixtures";
import { routes } from "@/routes/router";

const DITHER_MONO = makeDesignType({
  id: "22222222-2222-4222-8222-222222222222",
  slug: "dither-mono",
  name: "Dither Mono",
  sortOrder: 1,
  referenceCount: 2,
  description:
    "Stark black-and-white with bitmap/dither texture. Serif display carrying full authority. Split-screen form-plus-art layouts. Grain everywhere.",
  deployFor:
    "Portfolios, agencies, waitlists - anywhere restraint reads as confidence.",
  risk: "Dither the entire hero image to 1-bit and let a cropped wordmark run off the viewport",
  briefBlock:
    "# Dither Mono\n\nNear-monochrome ground, one warm accent, processed imagery only.",
  vocabulary: [
    "bitmap dither",
    "stark B&W",
    "film grain",
    "serif display",
    "split-screen form + art",
    "giant cropped wordmark",
    "high contrast",
  ],
  principles: [
    "Imagery is processed, never raw - halftone, dither, grain, ASCII, linework",
    "Technical marginalia - coordinates, IDs, ruler ticks, registration marks",
    "Near-monochrome ground plus a single warm accent",
  ],
  avoid: [
    "Glossy 3D SaaS blobs",
    "Untextured stock photography",
    "Rounded-everything friendliness",
  ],
});

/** A type the curator has filed but not yet written up. */
const BARE = makeDesignType({
  id: "44444444-4444-4444-8444-444444444444",
  slug: "bare-type",
  name: "Bare Type",
  sortOrder: 2,
  referenceCount: 0,
  vocabulary: [],
  principles: [],
  avoid: [],
});

const PLATE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000009",
  title: "Foundry Notice",
  designTypeId: DITHER_MONO.id,
  designDNA: "stark B&W x bitmap",
  catalogueIndex: 1,
});

function stubApi(references: unknown[] = []) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/design-types")) return json([DITHER_MONO, BARE]);
    if (url.includes("/collections")) return json([]);
    if (url.includes("/stats")) return json(makeStats({ totalReferences: 2 }));
    if (url.includes("/references")) {
      return json({
        items: references,
        page: 1,
        limit: 24,
        total: references.length,
        totalPages: references.length > 0 ? 1 : 0,
      });
    }
    return json({});
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string): void {
  const router = createMemoryRouter([...routes], { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("design-type style guide", () => {
  it("renders the stored identity, summary, deploy-for and risk", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    expect(
      await screen.findByRole("heading", { level: 1, name: /dither mono/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(DITHER_MONO.description)).toBeInTheDocument();
    expect(screen.getByText(/deploy for/i)).toBeInTheDocument();
    expect(
      screen.getByText(/anywhere restraint reads as confidence/i),
    ).toBeInTheDocument();
    expect(screen.getByText("RISK:")).toBeInTheDocument();
    expect(screen.getByText(DITHER_MONO.risk)).toBeInTheDocument();
  });

  it("exposes the whole vocabulary without the catalogue's +N truncation", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    await screen.findByRole("heading", { level: 1, name: /dither mono/i });

    for (const term of DITHER_MONO.vocabulary) {
      expect(screen.getByText(term)).toBeInTheDocument();
    }
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("prints every principle and every anti-pattern", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    await screen.findByRole("heading", { level: 1, name: /dither mono/i });

    for (const principle of DITHER_MONO.principles) {
      expect(screen.getByText(principle)).toBeInTheDocument();
    }
    for (const rule of DITHER_MONO.avoid) {
      expect(screen.getByText(rule)).toBeInTheDocument();
    }
    expect(screen.getByText(/^principles$/i)).toBeInTheDocument();
    expect(screen.getByText(/^avoid$/i)).toBeInTheDocument();
  });

  it("copies the stored brief block and confirms in place", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    const button = await screen.findByRole("button", { name: /copy brief block/i });
    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledWith(DITHER_MONO.briefBlock);
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
  });

  it("copies the vocabulary as plain lines, with no labels", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    const button = await screen.findByRole("button", { name: /copy vocab only/i });
    await userEvent.click(button);

    expect(writeText).toHaveBeenCalledWith(DITHER_MONO.vocabulary.join("\n"));
  });

  it("returns the copy control to its label after confirming", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    const button = await screen.findByRole("button", { name: /copy vocab only/i });
    await userEvent.click(button);
    expect(screen.getByRole("button", { name: /^copied$/i })).toBeInTheDocument();

    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: /copy vocab only/i }),
        ).toBeInTheDocument(),
      { timeout: 4_000 },
    );
  });

  it("says so when the clipboard refuses rather than claiming success", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    const button = await screen.findByRole("button", { name: /copy vocab only/i });
    await userEvent.click(button);

    expect(await screen.findByRole("button", { name: /copy failed/i })).toBeInTheDocument();
  });

  it("renders the plates for the type beneath the guide", async () => {
    stubApi([PLATE]);
    renderAt("/type/dither-mono");

    const plate = await screen.findByRole("article");
    expect(within(plate).getByRole("heading", { name: "Foundry Notice" })).toBeInTheDocument();
    expect(within(plate).getByText("stark B&W x bitmap")).toBeInTheDocument();
  });

  it("keeps the rail in step, with the active type filled", async () => {
    const fetchMock = stubApi([PLATE]);
    renderAt("/type/dither-mono");

    // The <nav> renders immediately in its loading state, so awaiting the nav
    // resolves before any tab exists. Await a tab instead.
    const active = await screen.findByRole("link", { name: /dither mono/i });
    expect(active).toHaveAttribute("href", "/type/dither-mono");
    expect(active.className).toMatch(/active/);

    const rail = screen.getByRole("navigation", { name: /catalogue filters/i });
    expect(within(rail).getByRole("link", { name: /^all/i }).className).not.toMatch(
      /active/,
    );

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("designType=dither-mono"))).toBe(true);
    });
  });

  it("still shows the guide for a type with no references filed", async () => {
    stubApi([]);
    renderAt("/type/bare-type");

    expect(
      await screen.findByRole("heading", { level: 1, name: /bare type/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /no plates under bare type/i }),
    ).toBeInTheDocument();
  });

  it("states missing guide metadata instead of inventing copy", async () => {
    stubApi([]);
    renderAt("/type/bare-type");

    await screen.findByRole("heading", { level: 1, name: /bare type/i });
    expect(screen.getByText(/no vocabulary recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no principles recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/no anti-patterns recorded/i)).toBeInTheDocument();
  });

  it("shows no guide at all for a slug the archive does not hold", async () => {
    stubApi([]);
    renderAt("/type/not-a-real-type");

    expect(
      await screen.findByRole("heading", { name: /no design type called not-a-real-type/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /copy brief block/i })).toBeNull();
    /*
     * The page still carries its own h1 — the slice name, for screen readers —
     * so absence of the guide is proved by the guide's own title being gone,
     * not by the page having no level-1 heading at all.
     */
    expect(
      screen.queryByRole("heading", { level: 1, name: /^dither mono$/i }),
    ).toBeNull();
    expect(document.querySelector("#design-type-title")).toBeNull();
  });
});
