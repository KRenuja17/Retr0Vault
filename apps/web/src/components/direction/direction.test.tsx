import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
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
} from "@/test/harness";

/*
 * The design synthesis worksheet. Retr0Vault authors no direction: the two
 * halves tested here are the manifest that leaves for an external agent and the
 * authored result that comes back to be formatted.
 */

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
});

const SPADE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spade",
});

const MONOLITH = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  title: "Monolith",
});

const MANIFEST_MD = "# Retr0Vault Pending Combination\n\n## Sources\n";
const DIRECTION_MD = "# Retr0Vault Design Direction\n\n## Primary Reference\n";

interface DirectionStubs {
  readonly directionResponse?: () => Response;
}

function stubWorksheet({ directionResponse }: DirectionStubs = {}): StubbedApi {
  return stubApi([
    {
      path: /^\/references\/[0-9a-f-]+$/u,
      handler: ({ pathname }) => {
        const id = pathname.split("/").pop();
        return (
          [STILLPAGE, SPADE, MONOLITH].find((reference) => reference.id === id) ??
          apiError(404, "NOT_FOUND", "gone")
        );
      },
    },
    {
      method: "POST",
      path: /^\/export\/design-direction$/u,
      handler: ({ body }) =>
        directionResponse?.() ??
        markdown(
          (body as { mode?: string }).mode === "authored"
            ? DIRECTION_MD
            : MANIFEST_MD,
          (body as { mode?: string }).mode === "authored"
            ? "retr0vault-direction-a1b2c3.md"
            : "retr0vault-pending-combination-d4e5f6.md",
        ),
    },
    {
      method: "POST",
      path: /^\/export\/references$/u,
      handler: () => markdown("# Retr0Vault References\n", "retr0vault-references-99.md"),
    },
  ]);
}

function worksheet(...ids: readonly string[]) {
  return `/direction?${REFS_PARAM}=${ids.join(",")}`;
}

/** The body of the last request sent to the design-direction endpoint. */
function lastDirectionBody(api: StubbedApi): Record<string, unknown> {
  const sent = api.requests.filter(
    (request) =>
      request.method === "POST" && request.pathname === "/export/design-direction",
  );
  const last = sent[sent.length - 1];
  if (last === undefined) {
    throw new Error("The worksheet sent no design-direction request.");
  }
  return last.body as Record<string, unknown>;
}

const AUTHORED_DIRECTION = {
  title: "Technical Editorial Monolith",
  designDNA: "warm print surface x technical hierarchy",
  designThesis: "A paper ground carrying one oversized image and a strict type ladder.",
  vocabulary: ["warm paper ground", "tabular numerals"],
  dimensions: {
    typography: "Spade controls the type ladder.",
    layout: "Spade controls structure.",
    colour: "Stillpage controls the surface treatment.",
    textureImagery: "Monolith controls scale.",
    uiTreatment: "Square outlines throughout.",
    motion: "No motion beyond colour transitions.",
  },
  borrowings: [
    { referenceId: STILLPAGE.id, borrow: "warm print surface, editorial whitespace" },
    { referenceId: SPADE.id, borrow: "structured technical typography" },
  ],
  authority: [
    { dimension: "typography", referenceId: SPADE.id, decision: "Spade" },
    { dimension: "layout", referenceId: SPADE.id, decision: "Spade" },
    { dimension: "colour", referenceId: STILLPAGE.id, decision: "Stillpage" },
    { dimension: "textureImagery", referenceId: STILLPAGE.id, decision: "Stillpage" },
    { dimension: "uiTreatment", referenceId: SPADE.id, decision: "Spade" },
    { dimension: "motion", referenceId: STILLPAGE.id, decision: "Stillpage" },
  ],
  conflicts: [
    { conflict: "Spade is dense; Stillpage is airy.", resolution: "Spade sets structure, Stillpage sets margins." },
  ],
  antiPatterns: ["averaging the two grids"],
  designBrief: "Build a warm paper editorial surface with a strict technical type ladder.",
  imageRecipes: ["A [SUBJECT] rendered as a duotone halftone plate."],
};

describe("the worksheet", () => {
  it("lists the selected sources in order and names only the first as primary", async () => {
    stubWorksheet();
    renderRoute(worksheet(SPADE.id, STILLPAGE.id));

    expect(await screen.findByRole("link", { name: "Spade" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    const sources = screen.getAllByRole("listitem");
    const spade = sources.find((item) => item.textContent?.includes("Spade"));
    const stillpage = sources.find((item) => item.textContent?.includes("Stillpage"));
    expect(spade).toHaveTextContent(/primary/i);
    expect(stillpage).not.toHaveTextContent(/primary/i);
    expect(screen.getByText(/02 sources/i)).toBeInTheDocument();
  });

  it("states what the manifest asks the external agent to decide", async () => {
    stubWorksheet();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(screen.getByText(/identify what to borrow from each/i)).toBeInTheDocument();
    expect(screen.getByText(/detect where the references contradict/i)).toBeInTheDocument();
    expect(screen.getByText(/assign authority for each design dimension/i)).toBeInTheDocument();
    expect(screen.getByText(/resolve the contradictions rather than averaging/i)).toBeInTheDocument();
  });

  it("says plainly that the archive stores no direction", async () => {
    stubWorksheet();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(screen.getByText(/directions are not stored/i)).toBeInTheDocument();
    expect(screen.getByText(/the archive holds no direction record/i)).toBeInTheDocument();
  });

  it("asks for more plates when the address names only one", async () => {
    stubWorksheet();
    renderRoute(worksheet(STILLPAGE.id));

    expect(
      await screen.findByText(/a design direction needs at least 2 references/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /generate manifest/i }),
    ).not.toBeInTheDocument();
  });
});

describe("generating the combination manifest", () => {
  it("sends exactly the selected ids, in selection order", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(MONOLITH.id, STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Monolith" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate manifest/i }));

    expect(await screen.findByText(/downloaded retr0vault-pending-combination/i)).toBeInTheDocument();
    expect(lastDirectionBody(api)).toEqual({
      mode: "pending-combination",
      referenceIds: [MONOLITH.id, STILLPAGE.id, SPADE.id],
    });
  });

  it("carries the intent when one is written, and omits it when not", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /generate manifest/i }));
    expect(await screen.findByText(/downloaded retr0vault-pending-combination/i)).toBeInTheDocument();
    expect(lastDirectionBody(api)).not.toHaveProperty("intent");

    await user.type(
      screen.getByLabelText(/what the direction is for/i),
      "  A restrained editorial portfolio.  ",
    );
    await user.click(screen.getByRole("button", { name: /generate manifest/i }));

    await screen.findByText(/downloaded retr0vault-pending-combination/i);
    expect(lastDirectionBody(api).intent).toBe("A restrained editorial portfolio.");
  });

  it("downloads the manifest the backend generated, under the backend's own name", async () => {
    stubWorksheet();
    const downloads = captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate manifest/i }));

    expect(await screen.findByText(/downloaded retr0vault-pending-combination/i)).toBeInTheDocument();
    expect(downloads.files).toHaveLength(1);
    expect(downloads.files[0]?.name).toBe("retr0vault-pending-combination-d4e5f6.md");
    await expect(downloads.text()).resolves.toBe(MANIFEST_MD);
  });

  it("reports a manifest the backend refused", async () => {
    stubWorksheet({
      directionResponse: () =>
        apiError(413, "PAYLOAD_TOO_LARGE", "The generated file exceeds 8 MiB. Select fewer references."),
    });
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /generate manifest/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/combination manifest failed/i);
    expect(alert).toHaveTextContent(/exceeds 8 MiB/i);
  });
});

describe("importing the authored direction", () => {
  it("sends a complete request body back exactly as the curator wrote it", async () => {
    const api = stubWorksheet();
    const downloads = captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    const payload = {
      mode: "authored",
      referenceIds: [STILLPAGE.id, SPADE.id],
      direction: AUTHORED_DIRECTION,
    };
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste(JSON.stringify(payload));
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByText(/downloaded retr0vault-direction/i)).toBeInTheDocument();
    expect(lastDirectionBody(api)).toEqual(payload);
    await expect(downloads.text()).resolves.toBe(DIRECTION_MD);
  });

  it("accepts a bare direction object and pairs it with the selection in the address", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste(JSON.stringify(AUTHORED_DIRECTION));
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByText(/downloaded retr0vault-direction/i)).toBeInTheDocument();
    expect(lastDirectionBody(api)).toEqual({
      mode: "authored",
      referenceIds: [STILLPAGE.id, SPADE.id],
      direction: AUTHORED_DIRECTION,
    });
  });

  it("reads the result out of a chosen file", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    const payload = {
      mode: "authored",
      referenceIds: [STILLPAGE.id, SPADE.id],
      direction: AUTHORED_DIRECTION,
    };
    await user.upload(
      screen.getByLabelText(/result file/i),
      new File([JSON.stringify(payload)], "reviewed-direction.json", {
        type: "application/json",
      }),
    );

    expect(await screen.findByDisplayValue(/Technical Editorial Monolith/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByText(/downloaded retr0vault-direction/i)).toBeInTheDocument();
    expect(lastDirectionBody(api)).toEqual(payload);
  });

  it("refuses malformed JSON without troubling the backend", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste("{ not json");
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByText(/that is not valid json/i)).toBeInTheDocument();
    expect(
      api.requests.some((request) => request.pathname === "/export/design-direction"),
    ).toBe(false);
  });

  it("refuses a JSON array, which cannot be a direction", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste("[1, 2, 3]");
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByText(/must be a json object/i)).toBeInTheDocument();
    expect(
      api.requests.some((request) => request.pathname === "/export/design-direction"),
    ).toBe(false);
  });

  it("surfaces the backend's own validation message, path and all", async () => {
    stubWorksheet({
      directionResponse: () =>
        apiError(
          400,
          "VALIDATION_ERROR",
          "direction.authority: Assign authority exactly once for each design dimension",
        ),
    });
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste(JSON.stringify(AUTHORED_DIRECTION));
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/design direction failed/i);
    expect(alert).toHaveTextContent(/direction.authority/i);
  });

  it("reports the API being down rather than blaming the result", async () => {
    stubWorksheet({
      directionResponse: () =>
        new Response("<html>proxy</html>", { status: 503 }),
    });
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByLabelText(/direction json/i));
    await user.paste(JSON.stringify(AUTHORED_DIRECTION));
    await user.click(screen.getByRole("button", { name: /format direction/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/127\.0\.0\.1:4611/);
  });

  it("clears a result without sending anything", async () => {
    const api = stubWorksheet();
    captureDownloads();
    const user = userEvent.setup();
    renderRoute(worksheet(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    const field = screen.getByLabelText(/direction json/i);
    await user.click(field);
    await user.paste("{ not json");
    await user.click(screen.getByRole("button", { name: /format direction/i }));
    expect(await screen.findByText(/that is not valid json/i)).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("main")).getByRole("button", { name: /^clear$/i }),
    );

    expect(field).toHaveValue("");
    expect(screen.queryByText(/that is not valid json/i)).not.toBeInTheDocument();
    expect(
      api.requests.some((request) => request.pathname === "/export/design-direction"),
    ).toBe(false);
  });
});
