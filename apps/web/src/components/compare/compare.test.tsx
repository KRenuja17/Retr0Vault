import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeDesignType, makeReference, makeTag } from "@/components/catalogue/fixtures";
import { REFS_PARAM } from "@/lib/selection/selection";
import { apiError, json, renderRoute, stubApi } from "@/test/harness";

/*
 * The comparison sheet. Every wait is on a reference's own title or on one of
 * its observations — never on the table, which is rendered as soon as the first
 * reference resolves and would pass while the rest were still in flight.
 */

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
});

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designTypeId: PRINT_TECH.id,
  designDNA: "warm print surface x editorial whitespace",
  designThesis: "A quiet paper ground that lets one image carry the page.",
  tags: [makeTag("halftone CMYK dot texture", 0), makeTag("warm paper ground", 1)],
  analysisJson: {
    typography: ["Newsreader display at 44px", "mono coordinate labels"],
    palette: ["bone white ground", "ember accent"],
    layout: ["three-column plate grid"],
    texture: ["4px halftone dot field"],
    imagery: ["duotone landscape plates"],
    uiPatterns: ["square outline buttons"],
    motion: ["no transitions beyond colour"],
    avoid: ["drop shadows", "rounded corners"],
  },
});

const SPADE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spade",
  designDNA: "structured technical typography",
  designThesis: "Information hierarchy carried entirely by type.",
  tags: [makeTag("tabular numerals", 0)],
  analysisJson: {
    typography: ["JetBrains Mono for every label"],
    palette: [],
    layout: ["dense two-column ledger"],
    texture: [],
    imagery: [],
    uiPatterns: [],
    motion: [],
    avoid: ["decorative illustration"],
  },
});

/** Analysed by nobody: every dimension is genuinely absent. */
const UNANALYSED = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  title: "Untitled Reference",
  analysisStatus: "pending",
  analysisJson: null,
});

function stubReferences(available: readonly { id: string }[] = [STILLPAGE, SPADE, UNANALYSED]) {
  return stubApi([
    { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
    {
      path: /^\/references\/[0-9a-f-]+$/u,
      handler: ({ pathname }) => {
        const id = pathname.split("/").pop();
        const found = available.find((reference) => reference.id === id);
        return (
          found ??
          apiError(404, "NOT_FOUND", "No reference with that identifier.")
        );
      },
    },
  ]);
}

function comparing(...ids: readonly string[]) {
  return `/compare?${REFS_PARAM}=${ids.join(",")}`;
}

/**
 * The cells of one dimension row, in column order.
 *
 * Located by the row's own header rather than by the row's accessible name: a
 * row is named by everything inside it, so "Typography" would also match the
 * Design DNA row of a reference whose DNA mentions typography.
 */
function cellsOf(label: string) {
  const header = screen
    .getAllByRole("rowheader")
    .find((cell) => cell.textContent?.trim() === label);
  if (header === undefined) {
    throw new Error(`No dimension row labelled "${label}".`);
  }
  const row = header.closest("tr");
  if (row === null) {
    throw new Error(`The "${label}" header is not inside a row.`);
  }
  return within(row).getAllByRole("cell");
}

describe("the comparison sheet", () => {
  it("prints every selected reference as a column, in selection order", async () => {
    stubReferences();
    renderRoute(comparing(SPADE.id, STILLPAGE.id));

    expect(await screen.findByRole("link", { name: "Spade" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    const columns = screen.getAllByRole("columnheader");
    // The first column is the dimension gutter.
    expect(columns).toHaveLength(3);
    expect(columns[1]).toHaveTextContent("Spade");
    expect(columns[2]).toHaveTextContent("Stillpage");
    expect(screen.getByText(/02 references/i)).toBeInTheDocument();
  });

  it("names the first selected reference as primary and no other", async () => {
    stubReferences();
    renderRoute(comparing(SPADE.id, STILLPAGE.id));

    expect(await screen.findByRole("link", { name: "Spade" })).toBeInTheDocument();
    const columns = screen.getAllByRole("columnheader");
    expect(columns[1]).toHaveTextContent(/primary/i);
    expect(columns[2]).not.toHaveTextContent(/primary/i);
  });

  it("aligns each dimension with the reference it belongs to", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByText("JetBrains Mono for every label")).toBeInTheDocument();

    const typography = cellsOf("Typography");
    expect(typography[0]).toHaveTextContent("Newsreader display at 44px");
    expect(typography[0]).toHaveTextContent("mono coordinate labels");
    expect(typography[0]).not.toHaveTextContent("JetBrains Mono");
    expect(typography[1]).toHaveTextContent("JetBrains Mono for every label");

    const dna = cellsOf("Design DNA");
    expect(dna[0]).toHaveTextContent("warm print surface x editorial whitespace");
    expect(dna[1]).toHaveTextContent("structured technical typography");

    const antiPatterns = cellsOf("Anti-patterns");
    expect(antiPatterns[0]).toHaveTextContent("drop shadows");
    expect(antiPatterns[1]).toHaveTextContent("decorative illustration");
  });

  it("prints the design type from the catalogue, not the raw id", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByText("Print-Tech Paper")).toBeInTheDocument();
    const types = cellsOf("Design type");
    expect(types[0]).toHaveTextContent("Print-Tech Paper");
    expect(types[1]).toHaveTextContent(/not recorded/i);
  });

  it("compares texture and imagery together, as the direction export does", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByText("4px halftone dot field")).toBeInTheDocument();
    const texture = cellsOf("Texture / imagery");
    expect(texture[0]).toHaveTextContent("4px halftone dot field");
    expect(texture[0]).toHaveTextContent("duotone landscape plates");
    expect(texture[1]).toHaveTextContent(/not recorded/i);
  });

  it("carries the vocabulary each reference actually holds", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByText("tabular numerals")).toBeInTheDocument();
    const vocabulary = cellsOf("Vocabulary");
    expect(vocabulary[0]).toHaveTextContent("halftone CMYK dot texture");
    expect(vocabulary[0]).toHaveTextContent("warm paper ground");
    expect(vocabulary[1]).toHaveTextContent("tabular numerals");
    expect(vocabulary[1]).not.toHaveTextContent("warm paper ground");
  });
});

describe("metadata the archive does not hold", () => {
  it("leaves an unanalysed reference blank rather than inventing observations", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, UNANALYSED.id));

    expect(await screen.findByRole("link", { name: "Untitled Reference" })).toBeInTheDocument();

    for (const label of [
      "Design DNA",
      "Design thesis",
      "Vocabulary",
      "Typography",
      "Colour",
      "Layout",
      "Texture / imagery",
      "UI treatment",
      "Motion",
      "Anti-patterns",
    ]) {
      const cells = cellsOf(label);
      expect(cells[1]).toHaveTextContent(/not recorded/i);
    }
  });

  it("marks an absent dimension for a screen reader, not only with a dash", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByText("bone white ground")).toBeInTheDocument();
    const colour = cellsOf("Colour");
    expect(within(colour[1] as HTMLElement).getByText("Not recorded")).toBeInTheDocument();
  });
});

describe("the sheet's structure", () => {
  it("is a real table with a caption and both header directions", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();

    const table = screen.getByRole("table");
    expect(within(table).getByText(/compared across design type/i)).toBeInTheDocument();

    for (const header of within(table).getAllByRole("columnheader")) {
      expect(header).toHaveAttribute("scope", "col");
    }
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header).toHaveAttribute("scope", "row");
    }
  });

  it("keeps a wide sheet inside a named, keyboard-reachable scroll region", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    const region = screen.getByRole("region", { name: /comparison sheet/i });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getByRole("table")).toBeInTheDocument();
  });

  it("links each column back to its own reference sheet", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toHaveAttribute(
      "href",
      `/reference/${STILLPAGE.id}`,
    );
  });
});

describe("a selection the sheet cannot work with", () => {
  it("asks for more plates when the address names only one", async () => {
    stubReferences();
    renderRoute(comparing(STILLPAGE.id));

    expect(
      await screen.findByText(/a comparison needs at least 2 references/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("discards ids the address should never have carried", async () => {
    stubReferences();
    renderRoute(`/compare?${REFS_PARAM}=${STILLPAGE.id},not-a-uuid`);

    expect(
      await screen.findByText(/a comparison needs at least 2 references/i),
    ).toBeInTheDocument();
  });

  it("reports references that could not be read without losing the rest", async () => {
    stubReferences([STILLPAGE]);
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(
      await screen.findByText(/1 of 2 references could not be read/i),
    ).toBeInTheDocument();
  });

  it("explains a sheet whose references have all gone", async () => {
    stubReferences([]);
    renderRoute(comparing(STILLPAGE.id, SPADE.id));

    expect(
      await screen.findByText(/those references could not be read/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

describe("leaving the sheet", () => {
  it("returns to the exact catalogue view it was opened from", async () => {
    stubApi([
      { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
      {
        path: /^\/references$/u,
        handler: () =>
          json({ items: [], page: 1, limit: 24, total: 0, totalPages: 0 }),
      },
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
    ]);
    const user = userEvent.setup();
    const view = renderRoute(comparing(STILLPAGE.id, SPADE.id), ["/all?q=grain"]);

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^close to/i }));

    expect(view.location().pathname).toBe("/all");
    expect(view.location().search).toBe("?q=grain");
  });
});
