import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeReference } from "@/components/catalogue/fixtures";
import { REFS_PARAM } from "@/lib/selection/selection";
import {
  apiError,
  captureDownloads,
  markdown,
  renderRoute,
  stubApi,
  type StubbedApi,
  type StubRequest,
} from "@/test/harness";

/*
 * Markdown export. The backend owns every document: these tests assert what the
 * archive asked for, and that whatever came back was handed to the browser
 * unaltered under the filename the API chose.
 */

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
});

const SPADE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spade",
});

/*
 * A reference export, as the backend renders one: each selected reference in a
 * single document, with the image recipe inside it. There is no separate
 * image-recipe export mode, so this is the document that carries recipes.
 */
const REFERENCES_MD = [
  "# Retr0Vault References",
  "",
  "## Stillpage",
  "",
  "### Design Brief",
  "",
  "````text",
  "A warm paper editorial surface.",
  "````",
  "",
  "### Image Recipe",
  "",
  "````text",
  "A [SUBJECT] rendered as a duotone halftone plate.",
  "````",
  "",
  "## Spade",
  "",
  "### Image Recipe",
  "",
  "````text",
  "A [SUBJECT] as a technical line drawing.",
  "````",
  "",
].join("\n");

const VOCABULARY_MD = [
  "# Retr0Vault Visual Vocabulary",
  "",
  "- imagery: halftone CMYK dot texture",
  "- imagery: tabular numerals",
  "",
].join("\n");

interface ExportStubs {
  readonly referencesResponse?: () => Response;
}

function stubExports({ referencesResponse }: ExportStubs = {}): StubbedApi {
  return stubApi([
    {
      path: /^\/references\/[0-9a-f-]+$/u,
      handler: ({ pathname }) => {
        const id = pathname.split("/").pop();
        return (
          [STILLPAGE, SPADE].find((reference) => reference.id === id) ??
          apiError(404, "NOT_FOUND", "gone")
        );
      },
    },
    {
      method: "POST",
      path: /^\/export\/references$/u,
      handler: ({ body }) => {
        if (referencesResponse !== undefined) {
          return referencesResponse();
        }
        return (body as { mode?: string }).mode === "vocabulary"
          ? markdown(VOCABULARY_MD, "retr0vault-vocabulary-7f7f7f.md")
          : markdown(REFERENCES_MD, "retr0vault-references-1a1a1a.md");
      },
    },
  ]);
}

/** The export desk on the comparison sheet, where both references are present. */
async function openSheet() {
  const user = userEvent.setup();
  renderRoute(`/compare?${REFS_PARAM}=${STILLPAGE.id},${SPADE.id}`);
  expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: "Spade" })).toBeInTheDocument();
  return user;
}

function exportRequests(api: StubbedApi): readonly StubRequest[] {
  return api.requests.filter(
    (request) =>
      request.method === "POST" && request.pathname === "/export/references",
  );
}

describe("exporting reference briefs", () => {
  it("asks for every selected reference in one document, in selection order", async () => {
    const api = stubExports();
    captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));

    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();
    expect(exportRequests(api)).toHaveLength(1);
    expect(exportRequests(api)[0]?.body).toEqual({
      mode: "references",
      referenceIds: [STILLPAGE.id, SPADE.id],
    });
  });

  it("downloads the backend's Markdown verbatim, under the backend's filename", async () => {
    stubExports();
    const downloads = captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));

    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();
    expect(downloads.files[0]?.name).toBe("retr0vault-references-1a1a1a.md");
    await expect(downloads.text()).resolves.toBe(REFERENCES_MD);
  });

  it("carries the image recipes, which have no export of their own", async () => {
    stubExports();
    const downloads = captureDownloads();
    const user = await openSheet();

    /*
     * The backend's reference export is where recipes live: it renders an
     * "Image Recipe" section per reference. Asking for them separately would
     * return this same document under a name that promised less, so the desk
     * says what the brief export contains instead.
     */
    expect(screen.getByText(/design brief, image\s+recipe/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));
    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();

    const document = await downloads.text();
    expect(document).toContain("### Image Recipe");
    expect(document).toContain("A [SUBJECT] rendered as a duotone halftone plate.");
    expect(document).toContain("A [SUBJECT] as a technical line drawing.");
  });

  it("combines several references into a single Markdown file", async () => {
    stubExports();
    const downloads = captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));
    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();

    expect(downloads.files).toHaveLength(1);
    const document = await downloads.text();
    expect(document).toContain("## Stillpage");
    expect(document).toContain("## Spade");
  });
});

describe("exporting vocabulary", () => {
  it("asks the vocabulary mode for the same selection", async () => {
    const api = stubExports();
    const downloads = captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /^vocabulary$/i }));

    expect(await screen.findByText(/downloaded retr0vault-vocabulary/i)).toBeInTheDocument();
    expect(exportRequests(api)[0]?.body).toEqual({
      mode: "vocabulary",
      referenceIds: [STILLPAGE.id, SPADE.id],
    });
    await expect(downloads.text()).resolves.toBe(VOCABULARY_MD);
  });
});

describe("exporting the combination manifest from a sheet", () => {
  it("uses the design-direction endpoint, not the reference one", async () => {
    const api = stubApi([
      {
        path: /^\/references\/[0-9a-f-]+$/u,
        handler: ({ pathname }) => {
          const id = pathname.split("/").pop();
          return (
            [STILLPAGE, SPADE].find((reference) => reference.id === id) ??
            apiError(404, "NOT_FOUND", "gone")
          );
        },
      },
      {
        method: "POST",
        path: /^\/export\/design-direction$/u,
        handler: () => markdown("# Pending\n", "retr0vault-pending-combination-22.md"),
      },
    ]);
    captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /combination manifest/i }));

    expect(await screen.findByText(/downloaded retr0vault-pending-combination/i)).toBeInTheDocument();
    const sent = api.requests.filter((request) => request.method === "POST");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe("/export/design-direction");
    expect(sent[0]?.body).toEqual({
      mode: "pending-combination",
      referenceIds: [STILLPAGE.id, SPADE.id],
    });
  });
});

describe("when the export endpoint refuses", () => {
  it("prints the API's own message instead of a silent failure", async () => {
    stubExports({
      referencesResponse: () =>
        apiError(404, "NOT_FOUND", "One or more selected references do not exist."),
    });
    const downloads = captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/reference briefs failed/i);
    expect(alert).toHaveTextContent(/do not exist/i);
    expect(downloads.files).toHaveLength(0);
  });

  it("reports an unreachable API rather than a server fault", async () => {
    stubExports({
      referencesResponse: () => new Response("", { status: 503 }),
    });
    captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/127\.0\.0\.1:4611/);
  });

  it("recovers: a second attempt after a failure still works", async () => {
    let fail = true;
    stubExports({
      referencesResponse: () => {
        if (fail) {
          fail = false;
          return apiError(500, "INTERNAL", "Something broke.");
        }
        return markdown(REFERENCES_MD, "retr0vault-references-1a1a1a.md");
      },
    });
    const downloads = captureDownloads();
    const user = await openSheet();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /reference briefs/i }));
    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();
    expect(downloads.files).toHaveLength(1);
  });
});

describe("the export desk in the catalogue", () => {
  it("stays shut until plates are marked and EXPORT is opened", async () => {
    stubApi([
      {
        path: /^\/references$/u,
        handler: () => ({
          items: [
            { ...STILLPAGE, catalogueIndex: 1 },
            { ...SPADE, catalogueIndex: 2 },
          ],
          page: 1,
          limit: 24,
          total: 2,
          totalPages: 1,
        }),
      },
    ]);
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));

    const openExports = screen.getByRole("button", { name: /^export$/i });
    expect(openExports).toBeDisabled();
    expect(
      screen.queryByRole("button", { name: /reference briefs/i }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Mark Stillpage" }));
    expect(openExports).toBeEnabled();
    expect(openExports).toHaveAttribute("aria-expanded", "false");

    await user.click(openExports);
    expect(openExports).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /reference briefs/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^vocabulary$/i })).toBeEnabled();
    // One plate is not a combination.
    expect(screen.getByRole("button", { name: /combination manifest/i })).toBeDisabled();
  });

  it("exports exactly the marked plates, not the page they sit on", async () => {
    const api = stubApi([
      {
        path: /^\/references$/u,
        handler: () => ({
          items: [
            { ...STILLPAGE, catalogueIndex: 1 },
            { ...SPADE, catalogueIndex: 2 },
          ],
          page: 1,
          limit: 24,
          total: 2,
          totalPages: 1,
        }),
      },
      {
        method: "POST",
        path: /^\/export\/references$/u,
        handler: () => markdown(REFERENCES_MD, "retr0vault-references-1a1a1a.md"),
      },
    ]);
    captureDownloads();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await user.click(screen.getByRole("checkbox", { name: "Mark Spade" }));
    await user.click(screen.getByRole("button", { name: /^export$/i }));
    await user.click(screen.getByRole("button", { name: /reference briefs/i }));

    expect(await screen.findByText(/downloaded retr0vault-references/i)).toBeInTheDocument();
    expect(
      api.requests.find((request) => request.pathname === "/export/references")?.body,
    ).toEqual({ mode: "references", referenceIds: [SPADE.id] });
  });
});
