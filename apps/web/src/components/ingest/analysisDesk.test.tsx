import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeDesignType, makeStats, makeTag } from "@/components/catalogue/fixtures";

import { AnalysisDesk } from "./AnalysisDesk";
import {
  apiError,
  makeImportReport,
  makeJsonFile,
  makeManifest,
  makeStoredReference,
  renderIngest,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "./testHarness";

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
});

const PENDING = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Nightlife, Refined",
  analysisStatus: "pending",
});

const ANALYZED = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Stillpage",
  analysisStatus: "analyzed",
  designTypeId: PRINT_TECH.id,
  designDNA: "warm editorial x print DNA",
  tags: [makeTag("halftone CMYK dot texture", 0)],
});

/**
 * The desk reads the reference list twice with different parameters — once for
 * the ledger, once for the failed count — so the stub answers on the query.
 */
function referencesRoute(pages: {
  readonly ledger?: () => unknown;
  readonly failed?: number;
}): StubRoute {
  return {
    path: /^\/references$/u,
    handler: ({ search }) => {
      if (search.get("status") === "failed") {
        return { items: [], page: 1, limit: 1, total: pages.failed ?? 0, totalPages: 1 };
      }
      return (
        pages.ledger?.() ?? {
          items: [],
          page: 1,
          limit: 12,
          total: 0,
          totalPages: 0,
        }
      );
    },
  };
}

function ledgerPage(items: readonly unknown[]) {
  return {
    items: [...items],
    page: 1,
    limit: 12,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
  };
}

function requestsTo(
  requests: readonly StubRequest[],
  method: string,
  path: RegExp,
): readonly StubRequest[] {
  return requests.filter(
    (request) => request.method === method && path.test(request.pathname),
  );
}

/** Object URLs do not exist in jsdom; the export path needs one to hand over. */
function stubObjectUrls() {
  const created = vi.fn(() => "blob:retr0vault/manifest");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
  return created;
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, "createObjectURL");
  Reflect.deleteProperty(URL, "revokeObjectURL");
});

describe("the analysis counts", () => {
  it("prints pending, analyzed and failed from the archive", async () => {
    stubApi([
      {
        path: /^\/stats$/u,
        handler: () =>
          makeStats({
            totalReferences: 22,
            pendingReferences: 4,
            analyzedReferences: 17,
          }),
      },
      referencesRoute({ failed: 1 }),
    ]);
    renderIngest(<AnalysisDesk />);

    /*
     * The tile is on the page from the first render showing "——", so the
     * assertion waits for the number inside it — the only thing that cannot
     * exist before that count's own request has resolved.
     */
    const counted = async (label: string, value: string) => {
      const tile = screen.getByRole("group", { name: label });
      expect(await within(tile).findByText(value)).toBeInTheDocument();
    };

    await counted("Pending", "04");
    await counted("Analyzed", "17");
    await counted("Failed", "01");
    await counted("In archive", "22");
  });

  it("shows an unread count as unread rather than as none", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderIngest(<AnalysisDesk />);

    expect(
      await screen.findByText(/counts unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("——")).toHaveLength(4);
    expect(screen.queryByText("00")).toBeNull();
  });
});

describe("the accession ledger", () => {
  it("shows a newly filed reference as awaiting analysis", async () => {
    stubApi([referencesRoute({ ledger: () => ledgerPage([PENDING, ANALYZED]) })]);
    renderIngest(<AnalysisDesk />);

    // The ledger row exists only once the list request has resolved.
    await screen.findByRole("link", { name: "Nightlife, Refined" });
    const [first] = screen.getAllByRole("listitem");
    expect(within(first!).getByRole("link", { name: "Nightlife, Refined" }))
      .toBeInTheDocument();
    expect(within(first!).getByText(/awaiting analysis/i)).toBeInTheDocument();
    expect(within(first!).getByText(/^image$/i)).toBeInTheDocument();
  });

  it("offers reset only for a reference that has been analysed", async () => {
    stubApi([referencesRoute({ ledger: () => ledgerPage([PENDING, ANALYZED]) })]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    const resets = screen.getAllByRole("button", { name: /^reset$/i });
    expect(resets).toHaveLength(2);
    // The pending row leads the ledger; its reset would be a no-op.
    expect(resets[0]).toBeDisabled();
    expect(resets[1]).toBeEnabled();
  });

  it("reports a ledger it could not read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderIngest(<AnalysisDesk />);

    expect(
      await screen.findByText(/could not reach the local api/i),
    ).toBeInTheDocument();
  });

  it("re-reads the archive when the status is refreshed", async () => {
    let reads = 0;
    stubApi([
      referencesRoute({
        ledger: () => {
          reads += 1;
          return reads === 1 ? ledgerPage([]) : ledgerPage([ANALYZED]);
        },
      }),
    ]);
    renderIngest(<AnalysisDesk />);

    expect(await screen.findByText(/no references filed yet/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /refresh status/i }));

    // Proof the refetch resolved, not merely that a refresh was requested.
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
  });
});

describe("exporting the pending manifest", () => {
  it("downloads the manifest and says how many references it holds", async () => {
    const created = stubObjectUrls();
    stubApi([
      referencesRoute({}),
      {
        path: /^\/analysis\/pending$/u,
        handler: () =>
          makeManifest({
            references: [
              {
                referenceId: PENDING.id,
                title: PENDING.title,
                sourceUrl: null,
                imagePath: "D:\\Retr0Vault\\storage\\originals\\a.png",
                frames: [],
                protectedFields: [],
              },
            ],
          }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.click(
      screen.getByRole("button", { name: /export pending manifest/i }),
    );

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/pending manifest exported/i);
    expect(notice).toHaveTextContent(/1 reference awaiting analysis/i);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it("names references whose image the manifest could not read", async () => {
    stubObjectUrls();
    stubApi([
      referencesRoute({}),
      {
        path: /^\/analysis\/pending$/u,
        handler: () =>
          makeManifest({
            unavailable: [
              { referenceId: PENDING.id, message: "Original image is missing" },
            ],
          }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.click(
      screen.getByRole("button", { name: /export pending manifest/i }),
    );

    expect(await screen.findByText(/original image is missing/i)).toBeInTheDocument();
  });

  it("reports a manifest the API could not build", async () => {
    stubApi([
      referencesRoute({}),
      {
        path: /^\/analysis\/pending$/u,
        handler: () => apiError(503, "DATABASE_BUSY", "The database is busy"),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.click(
      screen.getByRole("button", { name: /export pending manifest/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /the manifest could not be read/i,
    );
  });
});

describe("importing analysis JSON", () => {
  const analysis = (referenceId: string) => ({
    referenceId,
    title: "Stillpage",
    designType: "Print-Tech Paper",
    designDNA: "warm editorial x print DNA",
    designThesis: "A thesis.",
    visualTags: [{ type: "palette", value: "bone white" }],
    designBrief: "A brief.",
    imageRecipe: "[SUBJECT] on warm paper.",
    analysis: {
      palette: [], typography: [], layout: [], texture: [],
      imagery: [], uiPatterns: [], motion: [], avoid: [],
    },
  });

  it("sends every analysis in the chosen files and reports the result", async () => {
    const api = stubApi([
      referencesRoute({ ledger: () => ledgerPage([ANALYZED]) }),
      {
        method: "POST",
        path: /^\/analysis\/import$/u,
        handler: () => makeImportReport({ imported: 2, failed: 0 }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.upload(screen.getByLabelText(/import analysis json/i), [
      makeJsonFile("stillpage.json", analysis(ANALYZED.id)),
      makeJsonFile("nightlife.json", analysis(PENDING.id)),
    ]);

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/analysis imported/i);
    expect(notice).toHaveTextContent(/2 imported · 0 rejected/i);

    const sent = requestsTo(api.requests, "POST", /^\/analysis\/import$/u);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({
      analyses: [analysis(ANALYZED.id), analysis(PENDING.id)],
      overwriteProtected: false,
    });
  });

  it("accepts one file holding a list of analyses", async () => {
    const api = stubApi([
      referencesRoute({}),
      {
        method: "POST",
        path: /^\/analysis\/import$/u,
        handler: () => makeImportReport({ imported: 2 }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.upload(
      screen.getByLabelText(/import analysis json/i),
      makeJsonFile("batch.json", [analysis(ANALYZED.id), analysis(PENDING.id)]),
    );

    await screen.findByRole("status");
    const body = requestsTo(api.requests, "POST", /^\/analysis\/import$/u)[0]?.body;
    expect((body as { analyses: unknown[] }).analyses).toHaveLength(2);
  });

  it("names the file behind each rejected analysis", async () => {
    stubApi([
      referencesRoute({}),
      {
        method: "POST",
        path: /^\/analysis\/import$/u,
        handler: () =>
          makeImportReport({
            imported: 1,
            failed: 1,
            results: [
              {
                source: "0",
                referenceId: ANALYZED.id,
                status: "imported",
                preservedFields: [],
                error: null,
              },
              {
                source: "1",
                referenceId: PENDING.id,
                status: "failed",
                preservedFields: [],
                error: {
                  code: "INVALID_DESIGN_TYPE",
                  message: "Use an unambiguous existing design-type name",
                },
              },
            ],
          }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.upload(screen.getByLabelText(/import analysis json/i), [
      makeJsonFile("stillpage.json", analysis(ANALYZED.id)),
      makeJsonFile("nightlife.json", analysis(PENDING.id)),
    ]);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/some analyses were rejected/i);
    expect(alert).toHaveTextContent(/1 imported · 1 rejected/i);
    expect(alert).toHaveTextContent(
      /nightlife\.json — INVALID_DESIGN_TYPE: Use an unambiguous/i,
    );
  });

  it("refuses a file that is not JSON without sending anything", async () => {
    const api = stubApi([referencesRoute({})]);
    renderIngest(<AnalysisDesk />);

    await userEvent.upload(
      screen.getByLabelText(/import analysis json/i),
      new File(["not json at all"], "notes.json", { type: "application/json" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/nothing to import/i);
    expect(alert).toHaveTextContent(/notes\.json — not valid json/i);
    expect(requestsTo(api.requests, "POST", /^\/analysis\/import$/u)).toHaveLength(0);
  });

  it("carries the overwrite-protected choice into the request", async () => {
    const api = stubApi([
      referencesRoute({}),
      {
        method: "POST",
        path: /^\/analysis\/import$/u,
        handler: () => makeImportReport({ imported: 1 }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.click(screen.getByLabelText(/overwrite protected fields/i));
    await userEvent.upload(
      screen.getByLabelText(/import analysis json/i),
      makeJsonFile("stillpage.json", analysis(ANALYZED.id)),
    );

    await screen.findByRole("status");
    const body = requestsTo(api.requests, "POST", /^\/analysis\/import$/u)[0]?.body;
    expect(body).toMatchObject({ overwriteProtected: true });
  });

  it("reports an import the API refused", async () => {
    stubApi([
      referencesRoute({}),
      {
        method: "POST",
        path: /^\/analysis\/import$/u,
        handler: () =>
          apiError(400, "VALIDATION_ERROR", "analyses: Expected array"),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await userEvent.upload(
      screen.getByLabelText(/import analysis json/i),
      makeJsonFile("stillpage.json", analysis(ANALYZED.id)),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /analyses: Expected array/i,
    );
  });
});

describe("resetting an analysis", () => {
  it("returns a reference to the pending queue", async () => {
    let reads = 0;
    const api = stubApi([
      referencesRoute({
        ledger: () => {
          reads += 1;
          return ledgerPage([
            reads === 1
              ? ANALYZED
              : makeStoredReference({ ...ANALYZED, analysisStatus: "pending" }),
          ]);
        },
      }),
      {
        method: "POST",
        path: /^\/analysis\/[^/]+\/reset$/u,
        handler: () =>
          makeStoredReference({ ...ANALYZED, analysisStatus: "pending" }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /^reset$/i }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/reset to pending/i);
    expect(notice).toHaveTextContent(/Stillpage is awaiting analysis again/i);

    const sent = requestsTo(api.requests, "POST", /^\/analysis\/[^/]+\/reset$/u);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe(`/analysis/${ANALYZED.id}/reset`);
  });

  it("reports a reset the API refused", async () => {
    stubApi([
      referencesRoute({ ledger: () => ledgerPage([ANALYZED]) }),
      {
        method: "POST",
        path: /^\/analysis\/[^/]+\/reset$/u,
        handler: () =>
          apiError(404, "REFERENCE_NOT_FOUND", "Reference not found"),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /^reset$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /reference not found/i,
    );
  });
});

describe("editing generated metadata by hand", () => {
  it("sends only the changed fields and reports what is now protected", async () => {
    const api = stubApi([
      { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
      referencesRoute({ ledger: () => ledgerPage([ANALYZED]) }),
      {
        method: "PATCH",
        path: /^\/references\/[^/]+$/u,
        handler: () =>
          makeStoredReference({
            ...ANALYZED,
            designDNA: "stark editorial x bitmap",
            protectedFields: ["designDNA"],
          }),
      },
    ]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /edit metadata/i }));

    const dna = await screen.findByLabelText(/design dna/i);
    await userEvent.clear(dna);
    await userEvent.type(dna, "stark editorial x bitmap");
    await userEvent.click(screen.getByRole("button", { name: /save metadata/i }));

    const notice = await screen.findByRole("status");
    expect(notice).toHaveTextContent(/metadata saved/i);
    expect(notice).toHaveTextContent(/1 protected field/i);

    const sent = requestsTo(api.requests, "PATCH", /^\/references\/[^/]+$/u);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toEqual({ designDNA: "stark editorial x bitmap" });
  });

  it("refuses vocabulary that is not written as type and term", async () => {
    const api = stubApi([
      referencesRoute({ ledger: () => ledgerPage([ANALYZED]) }),
    ]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /edit metadata/i }));

    const vocabulary = await screen.findByLabelText(/vocabulary/i);
    await userEvent.clear(vocabulary);
    await userEvent.type(vocabulary, "just a loose term");
    await userEvent.click(screen.getByRole("button", { name: /save metadata/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /line 1 needs the form "type: term"/i,
    );
    expect(requestsTo(api.requests, "PATCH", /^\/references\/[^/]+$/u)).toHaveLength(0);
  });

  it("does not send an empty patch when nothing was changed", async () => {
    const api = stubApi([
      referencesRoute({ ledger: () => ledgerPage([ANALYZED]) }),
    ]);
    renderIngest(<AnalysisDesk />);

    await screen.findByRole("link", { name: "Stillpage" });
    await userEvent.click(screen.getByRole("button", { name: /edit metadata/i }));
    await userEvent.click(
      await screen.findByRole("button", { name: /save metadata/i }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(/nothing has changed/i);
    expect(requestsTo(api.requests, "PATCH", /^\/references\/[^/]+$/u)).toHaveLength(0);
  });
});
