import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ImageReplacement } from "./ImageReplacement";
import {
  apiError,
  makeFile,
  makeStoredReference,
  referencePage,
  renderIngest,
  stubApi,
  type StubRequest,
} from "@/test/harness";

const LANDO = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Lando Norris",
  sourceType: "website",
  sourceUrl: "https://landonorris.com/",
  analysisStatus: "analyzed",
  image: { width: 1440, height: 900, format: "png" },
  updatedAt: "2026-09-20T10:00:00.000Z",
});

const STILLPAGE = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Stillpage",
  analysisStatus: "pending",
});

const REPLACE = /^\/references\/[0-9a-f-]+\/image$/u;

function replacements(requests: readonly StubRequest[]) {
  return requests.filter((request) => request.method === "PUT" && REPLACE.test(request.pathname));
}

function sent(request: StubRequest | undefined, field: string) {
  return request?.body instanceof FormData ? request.body.get(field) : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function chooseLando() {
  await userEvent.click(await screen.findByRole("button", { name: /lando norris/i }));
}

describe("replacing a reference's picture", () => {
  it("sends the new picture for the chosen reference and reports it filed", async () => {
    const updated = { ...LANDO, image: { width: 1280, height: 800, format: "png" as const }, updatedAt: "2026-09-26T10:00:00.000Z" };
    const api = stubApi([
      { path: /^\/references$/u, handler: () => referencePage([LANDO, STILLPAGE]) },
      { method: "PUT", path: REPLACE, handler: () => updated },
    ]);
    renderIngest(<ImageReplacement />);

    const submit = screen.getByRole("button", { name: /replace the picture/i });
    expect(submit).toBeDisabled();
    await chooseLando();

    // The chosen reference's current picture is shown beside the mount.
    expect(screen.getByText("Website capture · 1440 × 900 · PNG")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /current picture of lando norris/i }))
      .toHaveAttribute("src", `/api/v1/media/${LANDO.id}/thumbnail?v=${encodeURIComponent(LANDO.updatedAt)}`);
    expect(submit).toBeDisabled();

    await userEvent.upload(screen.getByLabelText(/choose new picture/i), makeFile("lando-hero.png", "image/png"));
    expect(await screen.findByText(/lando-hero\.png/u)).toBeInTheDocument();
    await userEvent.click(submit);

    const outcome = await screen.findByRole("status");
    expect(outcome).toHaveTextContent("Lando Norris");
    expect(outcome).toHaveTextContent("1280 × 800");
    expect(within(outcome).getByRole("link", { name: /open the plate/i })).toHaveAttribute("href", `/reference/${LANDO.id}`);

    const [request] = replacements(api.requests);
    expect(request?.pathname).toBe(`/references/${LANDO.id}/image`);
    expect(sent(request, "file")).toBeInstanceOf(File);
    expect(sent(request, "resetAnalysis")).toBe("false");
    // The mount is cleared, and the "now" picture is the new one.
    expect(screen.getByRole("img", { name: /current picture of lando norris/i }))
      .toHaveAttribute("src", `/api/v1/media/${LANDO.id}/thumbnail?v=${encodeURIComponent(updated.updatedAt)}`);
    expect(screen.getByRole("button", { name: /replace the picture/i })).toBeDisabled();
  });

  it("offers re-analysis for an analysed reference, and sends it when checked", async () => {
    const api = stubApi([
      { path: /^\/references$/u, handler: () => referencePage([LANDO, STILLPAGE]) },
      { method: "PUT", path: REPLACE, handler: () => ({ ...LANDO, analysisStatus: "pending" }) },
    ]);
    renderIngest(<ImageReplacement />);
    await chooseLando();

    await userEvent.click(screen.getByRole("checkbox", { name: /file for re-analysis/i }));
    await userEvent.upload(screen.getByLabelText(/choose new picture/i), makeFile("hero.jpg", "image/jpeg"));
    await userEvent.click(screen.getByRole("button", { name: /replace the picture/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/awaiting analysis/i);
    expect(sent(replacements(api.requests)[0], "resetAnalysis")).toBe("true");
  });

  it("has nothing to re-analyse for a pending reference", async () => {
    stubApi([{ path: /^\/references$/u, handler: () => referencePage([LANDO, STILLPAGE]) }]);
    renderIngest(<ImageReplacement />);
    await userEvent.click(await screen.findByRole("button", { name: /stillpage/i }));
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("refuses a file the archive cannot hold before anything is sent", async () => {
    const api = stubApi([{ path: /^\/references$/u, handler: () => referencePage([LANDO]) }]);
    renderIngest(<ImageReplacement />);
    await chooseLando();

    await userEvent.upload(screen.getByLabelText(/choose new picture/i), makeFile("hero.gif", "image/gif"), { applyAccept: false });
    expect(screen.getByRole("alert")).toHaveTextContent(/only jpeg, png and webp/i);
    expect(screen.getByRole("button", { name: /replace the picture/i })).toBeDisabled();
    expect(replacements(api.requests)).toHaveLength(0);
  });

  it("says why a replacement failed, and that nothing changed", async () => {
    stubApi([
      { path: /^\/references$/u, handler: () => referencePage([LANDO]) },
      { method: "PUT", path: REPLACE, handler: () => apiError(400, "INVALID_IMAGE", "The uploaded file is not a valid readable image") },
    ]);
    renderIngest(<ImageReplacement />);
    await chooseLando();
    await userEvent.upload(screen.getByLabelText(/choose new picture/i), makeFile("hero.png", "image/png"));
    await userEvent.click(screen.getByRole("button", { name: /replace the picture/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That picture was not replaced");
    expect(alert).toHaveTextContent("not a valid readable image");
    expect(alert).toHaveTextContent("INVALID_IMAGE");
  });
});

describe("finding a reference in a larger archive", () => {
  // Eleven plates: the picker's first look holds the eight newest.
  const archive = Array.from({ length: 11 }, (_, index) => makeStoredReference({
    id: `bbbbbbbb-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Plate ${index + 1}`,
  }));

  function stubArchive() {
    return stubApi([{
      path: /^\/references$/u,
      handler: (request) => {
        const q = request.search.get("q");
        const matching = q ? archive.filter((reference) => reference.title.includes(q)) : archive;
        const limit = Number(request.search.get("limit"));
        return referencePage(matching.slice(0, limit), { total: matching.length, limit });
      },
    }]);
  }

  it("says the first list is partial, and shows every reference on request", async () => {
    const api = stubArchive();
    renderIngest(<ImageReplacement />);

    expect(await screen.findByText("Showing the 8 newest of 11")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Plate \d+/u })).toHaveLength(8);
    expect(screen.queryByRole("button", { name: /^Plate 11/u })).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(await screen.findByText("Showing all 11")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Plate 11/u })).toBeInTheDocument();
    expect(api.requests.some((request) => request.search.get("limit") === "100")).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Show fewer" }));
    expect(await screen.findByText("Showing the 8 newest of 11")).toBeInTheDocument();
  });

  it("counts search matches, and says nothing is hidden when the list is complete", async () => {
    stubArchive();
    renderIngest(<ImageReplacement />);
    await screen.findByText("Showing the 8 newest of 11");

    await userEvent.type(screen.getByRole("searchbox"), "Plate 1{Enter}");
    // Plate 1, 10 and 11.
    expect(await screen.findByText("3 matches")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show all/i })).toBeNull();
  });
});
