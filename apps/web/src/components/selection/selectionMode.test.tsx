import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeDesignType, makeReference } from "@/components/catalogue/fixtures";
import { clearPlateFocus } from "@/lib/catalogue/plateFocus";
import { REFS_PARAM } from "@/lib/selection/selection";
import { json, referencePage, renderRoute, stubApi } from "@/test/harness";

/*
 * Marking plates in the catalogue. Nothing here awaits the grid itself: the
 * plate container exists while its page is still in flight, so every wait is on
 * a plate title, which only appears once the catalogue request has resolved.
 */

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
  referenceCount: 3,
});

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designTypeId: PRINT_TECH.id,
});

const SPADE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spade",
});

const MONOLITH = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000003",
  title: "Monolith",
});

const GRAINED = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000009",
  title: "Grained Halftone",
});

/** The catalogue, with a search that reaches a different reference. */
function stubCatalogue() {
  return stubApi([
    { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
    {
      path: /^\/references$/u,
      handler: ({ search }) =>
        json(
          referencePage(
            search.get("q") === "grain"
              ? [GRAINED]
              : [STILLPAGE, SPADE, MONOLITH],
          ),
        ),
    },
    {
      path: /^\/references\/[0-9a-f-]+$/u,
      handler: ({ pathname }) => {
        const id = pathname.split("/").pop();
        const found = [STILLPAGE, SPADE, MONOLITH, GRAINED].find(
          (reference) => reference.id === id,
        );
        return found ?? json({}, 404);
      },
    },
  ]);
}

/** Marks a plate by title and returns its marking control. */
async function mark(user: ReturnType<typeof userEvent.setup>, title: string) {
  const control = screen.getByRole("checkbox", { name: `Mark ${title}` });
  await user.click(control);
  return control;
}

function selectionPanel() {
  return screen.getByRole("region", { name: /reference selection/i });
}

afterEach(() => {
  clearPlateFocus();
});

describe("entering selection mode", () => {
  it("keeps the plates unmarked until the archive is asked to select", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select references/i }));

    expect(
      screen.getByRole("checkbox", { name: "Mark Stillpage" }),
    ).toHaveAttribute("aria-checked", "false");
    expect(within(selectionPanel()).getByText(/marked 00 of 100/i)).toBeInTheDocument();
  });

  it("leaves selection mode without keeping invisible marks", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Stillpage");
    expect(within(selectionPanel()).getByText(/marked 01 of 100/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^done$/i }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /select references/i }));
    expect(within(selectionPanel()).getByText(/marked 00 of 100/i)).toBeInTheDocument();
  });
});

describe("marking plates", () => {
  it("marks, unmarks and counts", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));

    const stillpage = await mark(user, "Stillpage");
    expect(stillpage).toHaveAttribute("aria-checked", "true");
    expect(within(selectionPanel()).getByText(/marked 01 of 100/i)).toBeInTheDocument();

    await mark(user, "Spade");
    expect(within(selectionPanel()).getByText(/marked 02 of 100/i)).toBeInTheDocument();

    await user.click(stillpage);
    expect(stillpage).toHaveAttribute("aria-checked", "false");
    expect(within(selectionPanel()).getByText(/marked 01 of 100/i)).toBeInTheDocument();
  });

  it("clears every mark but stays in selection mode", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Stillpage");
    await mark(user, "Spade");

    await user.click(screen.getByRole("button", { name: /^clear$/i }));

    expect(within(selectionPanel()).getByText(/marked 00 of 100/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Mark Stillpage" }),
    ).toHaveAttribute("aria-checked", "false");
  });

  it("withholds both sheets until two plates are marked", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));

    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();

    await mark(user, "Stillpage");
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();

    await mark(user, "Spade");
    expect(
      screen.getByRole("link", { name: /^compare$/i }),
    ).toHaveAttribute(
      "href",
      `/compare?${REFS_PARAM}=${STILLPAGE.id}%2C${SPADE.id}`,
    );
    expect(
      screen.getByRole("link", { name: /create direction/i }),
    ).toHaveAttribute(
      "href",
      `/direction?${REFS_PARAM}=${STILLPAGE.id}%2C${SPADE.id}`,
    );
  });

  it("marks in the order the plates were struck, whatever their catalogue order", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));

    await mark(user, "Monolith");
    await mark(user, "Stillpage");

    expect(screen.getByRole("link", { name: /^compare$/i })).toHaveAttribute(
      "href",
      `/compare?${REFS_PARAM}=${MONOLITH.id}%2C${STILLPAGE.id}`,
    );
  });
});

describe("marking across a search and a filtered slice", () => {
  it("keeps marks made before a search that no longer shows those plates", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Stillpage");
    await mark(user, "Spade");

    await user.type(screen.getByRole("searchbox"), "grain");
    await user.click(screen.getByRole("button", { name: /^find$/i }));

    expect(
      await screen.findByRole("link", { name: "Grained Halftone" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Stillpage" })).not.toBeInTheDocument();

    // The marks survived the narrowing, and a search result joins them.
    expect(within(selectionPanel()).getByText(/marked 02 of 100/i)).toBeInTheDocument();
    await mark(user, "Grained Halftone");
    expect(screen.getByRole("link", { name: /^compare$/i })).toHaveAttribute(
      "href",
      `/compare?${REFS_PARAM}=${STILLPAGE.id}%2C${SPADE.id}%2C${GRAINED.id}`,
    );
  });

  it("carries the search back to the catalogue when the sheet closes", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    const view = renderRoute("/all?q=grain");

    expect(
      await screen.findByRole("link", { name: "Grained Halftone" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Grained Halftone");

    // One plate is not enough for a sheet; the origin is what is under test.
    expect(screen.getByRole("button", { name: /^compare$/i })).toBeDisabled();
    expect(view.location().search).toBe("?q=grain");
  });

  it("marks from inside a design-type slice", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    renderRoute("/type/print-tech-paper");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Stillpage");
    await mark(user, "Spade");

    const compare = screen.getByRole("link", { name: /^compare$/i });
    expect(compare).toHaveAttribute(
      "href",
      `/compare?${REFS_PARAM}=${STILLPAGE.id}%2C${SPADE.id}`,
    );
  });
});

describe("a reference sheet opened while plates are marked", () => {
  it("keeps the selection across the round trip and restores the plate's focus", async () => {
    stubCatalogue();
    const user = userEvent.setup();
    const view = renderRoute("/all");

    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /select references/i }));
    await mark(user, "Stillpage");
    await mark(user, "Spade");

    await user.click(screen.getByRole("link", { name: "Monolith" }));
    expect(view.location().pathname).toBe(`/reference/${MONOLITH.id}`);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /close/i }),
    );

    await waitFor(() => expect(view.location().pathname).toBe("/all"));
    expect(within(selectionPanel()).getByText(/marked 02 of 100/i)).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Mark Stillpage" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByRole("checkbox", { name: "Mark Monolith" }),
    ).toHaveAttribute("aria-checked", "false");
  });
});
