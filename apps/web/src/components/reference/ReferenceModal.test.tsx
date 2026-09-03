import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import {
  makeDesignType,
  makeReference,
  makeStats,
  makeTag,
} from "@/components/catalogue/fixtures";
import { clearPlateFocus } from "@/lib/catalogue/plateFocus";
import { routes } from "@/routes/router";

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
  referenceCount: 2,
});

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designTypeId: PRINT_TECH.id,
  designDNA: "warm editorial x print DNA",
  designThesis: "A quiet promise carried entirely by paper texture.",
  designBrief: "Borrow the ground and the rule weight, not the subject.",
  imageRecipe:
    "[SUBJECT: a bone-white studio still life] rendered on warm paper, halftone dot texture, one ember accent.",
  catalogueIndex: 1,
  tags: [
    makeTag("halftone CMYK dot texture", 0),
    makeTag("warm paper ground", 1),
    makeTag("mono coordinate labels", 2),
    makeTag("bone white with ember accent", 3),
  ],
});

/** Analysed, but the curator filled in nothing optional. */
const SPARSE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000004",
  title: "Sparse Plate",
  catalogueIndex: 1,
});

const PENDING = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Nightlife, Refined",
  analysisStatus: "pending",
  catalogueIndex: 2,
});

interface Options {
  readonly list?: unknown[];
  readonly detail?: unknown;
  readonly detailStatus?: number;
  /** The envelope the API pairs with that status, when it is not a 404. */
  readonly detailError?: { readonly code: string; readonly message: string };
}

function stubApi({
  list = [STILLPAGE],
  detail = STILLPAGE,
  detailStatus,
  detailError,
}: Options = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

    if (url.includes("/design-types")) return json([PRINT_TECH]);
    if (url.includes("/collections")) return json([]);
    if (url.includes("/stats")) return json(makeStats({ totalReferences: list.length }));

    // `/references/<id>` is the detail read; `/references?…` is the catalogue.
    if (/\/references\/[0-9a-f-]+/iu.test(url)) {
      if (detailStatus !== undefined) {
        return json(
          {
            error: {
              code: detailError?.code ?? "REFERENCE_NOT_FOUND",
              message: detailError?.message ?? "Reference not found",
              statusCode: detailStatus,
            },
            requestId: "req-4",
          },
          detailStatus,
        );
      }
      return json(detail);
    }

    if (url.includes("/references")) {
      return json({
        items: list,
        page: 1,
        limit: 24,
        total: list.length,
        totalPages: list.length > 0 ? 1 : 0,
      });
    }
    return json({});
  });

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderAt(path: string) {
  const router = createMemoryRouter([...routes], { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
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
  clearPlateFocus();
});

const dialog = () => screen.getByRole("dialog");

describe("reference modal", () => {
  it("opens from a catalogue plate and keeps the catalogue behind it", async () => {
    stubApi();
    renderAt("/all");

    const plate = await screen.findByRole("article");
    await userEvent.click(within(plate).getByRole("link", { name: "Stillpage" }));

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByText("warm editorial x print DNA"),
    ).toBeInTheDocument();
    /*
     * The catalogue is still mounted underneath, not replaced — but Radix marks
     * the rest of the document aria-hidden while the sheet is open, which is
     * correct, so it has to be queried as hidden.
     */
    expect(
      screen.getByRole("navigation", { name: /catalogue filters/i, hidden: true }),
    ).toBeInTheDocument();
  });

  it("shows the stored thesis, the full vocabulary and the recipe", async () => {
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByRole("heading", { name: "Stillpage" }),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(STILLPAGE.designThesis!)).toBeInTheDocument();

    for (const tag of STILLPAGE.tags) {
      expect(within(sheet).getByText(tag.value)).toBeInTheDocument();
    }

    // Anchored: /image recipe/i also matches the COPY IMAGE RECIPE button.
    expect(
      within(sheet).getByText(/^Image recipe \u2014 fill \[SUBJECT\]$/),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText(/\[SUBJECT: a bone-white studio still life\]/),
    ).toBeInTheDocument();
  });

  it("requests the original, never the thumbnail", async () => {
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    const sheet = await screen.findByRole("dialog");
    const image = await within(sheet).findByAltText("Stillpage reference capture");
    expect(image).toHaveAttribute("src", `/api/v1/media/${STILLPAGE.id}/original`);
    expect(image.getAttribute("src")).not.toContain("/thumbnail");
  });

  it("copies the design brief", async () => {
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    await userEvent.click(await screen.findByRole("button", { name: /copy brief/i }));
    expect(writeText).toHaveBeenCalledWith(STILLPAGE.designBrief);
    expect(await screen.findByRole("button", { name: /^copied$/i })).toBeInTheDocument();
  });

  it("copies the image recipe", async () => {
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    await userEvent.click(
      await screen.findByRole("button", { name: /copy image recipe/i }),
    );
    expect(writeText).toHaveBeenCalledWith(STILLPAGE.imageRecipe);
  });

  it("closes on the action row's CLOSE and returns to the catalogue", async () => {
    stubApi();
    renderAt("/all");

    const plate = await screen.findByRole("article");
    await userEvent.click(within(plate).getByRole("link", { name: "Stillpage" }));
    await screen.findByRole("dialog");

    await userEvent.click(within(dialog()).getByRole("button", { name: /^close$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("navigation", { name: /catalogue filters/i })).toBeInTheDocument();
  });

  it("closes on Escape", async () => {
    stubApi();
    renderAt("/all");

    const plate = await screen.findByRole("article");
    await userEvent.click(within(plate).getByRole("link", { name: "Stillpage" }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("returns focus to the plate that opened it", async () => {
    stubApi();
    renderAt("/all");

    const plate = await screen.findByRole("article");
    await userEvent.click(within(plate).getByRole("link", { name: "Stillpage" }));
    await screen.findByRole("dialog");

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    /*
     * The plate is a different DOM node than the one clicked — the catalogue
     * remounted behind the sheet — so this asserts the explicit hand-off, not
     * Radix's own restore, which cannot survive a route change.
     */
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Stillpage" })).toHaveFocus(),
    );
  });

  it("has no corner close affordance; CLOSE lives in the action row", async () => {
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    const sheet = await screen.findByRole("dialog");
    await within(sheet).findByRole("heading", { name: "Stillpage" });
    expect(within(sheet).getAllByRole("button", { name: /close/i })).toHaveLength(1);
  });

  it("opens a pending reference and says it is awaiting analysis", async () => {
    stubApi({ list: [PENDING], detail: PENDING });
    renderAt(`/reference/${PENDING.id}`);

    const sheet = await screen.findByRole("dialog");
    expect(await within(sheet).findByText(/awaiting analysis/i)).toBeInTheDocument();
    expect(within(sheet).getByText(/no image recipe filed/i)).toBeInTheDocument();
  });

  it("omits absent optional fields rather than printing empty rows", async () => {
    stubApi({ list: [SPARSE], detail: SPARSE });
    renderAt(`/reference/${SPARSE.id}`);

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByRole("heading", { name: "Sparse Plate" }),
    ).toBeInTheDocument();
    expect(within(sheet).queryByText(/x print DNA/)).toBeNull();
    expect(within(sheet).getByText(/no image recipe filed/i)).toBeInTheDocument();
  });

  it("reports a reference the archive does not hold", async () => {
    stubApi({ detailStatus: 404 });
    renderAt("/reference/aaaaaaaa-0000-4000-8000-00000000dead");

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByRole("heading", { name: /no such reference/i }),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("reads a malformed id as no such reference, not as a refused request", async () => {
    /*
     * The id is the only input this route takes, so the 400 the API answers for
     * an unparseable one means exactly what a 404 means to whoever followed the
     * link — not "the archive refused that request".
     */
    stubApi({
      detailStatus: 400,
      detailError: { code: "VALIDATION_ERROR", message: "id: Invalid UUID" },
    });
    renderAt("/reference/aaaaaaaa-0000-4000-8000-0000000000ff");

    const sheet = await screen.findByRole("dialog");
    expect(
      await within(sheet).findByRole("heading", { name: /no such reference/i }),
    ).toBeInTheDocument();
  });

  it("gives the scrolling sheet a name and a tab stop of its own", async () => {
    /*
     * Without one, a keyboard-only reader can reach the action row but can
     * never scroll the sheet holding the capture and the recipe.
     */
    stubApi();
    renderAt(`/reference/${STILLPAGE.id}`);

    const sheet = await screen.findByRole("dialog");
    const region = await within(sheet).findByRole("region", {
      name: /stillpage/i,
    });
    expect(region).toHaveAttribute("tabindex", "0");
  });
});
