import { afterEach, describe, expect, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  makeDesignType,
  makeReference,
  makeStats,
} from "@/components/catalogue/fixtures";
import { clearPlateFocus } from "@/lib/catalogue/plateFocus";
import {
  apiError,
  makeCollectionResponse,
  referencePage,
  renderRoute,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";

/*
 * Withdrawing a reference from the archive.
 *
 * Every test here drives the real route tree, so what is asserted is the whole
 * act: the question, the request, the catalogue the reader is returned to, and
 * what the archive says it holds afterwards.
 */

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
  referenceCount: 2,
});

const REFERENCE_STYLES = makeCollectionResponse({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
  referenceCount: 2,
});

const STILLPAGE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  designTypeId: PRINT_TECH.id,
  designBrief: "Borrow the ground and the rule weight, not the subject.",
});

const SPADE = makeReference({
  id: "aaaaaaaa-0000-4000-8000-000000000002",
  title: "Spade",
  designTypeId: PRINT_TECH.id,
});

const DETAIL = /^\/references\/[0-9a-f-]+$/iu;
const LIST = /^\/references$/u;

interface ArchiveOptions {
  /** What the archive holds; the delete removes from this in place. */
  readonly holds?: ReadonlyArray<ReturnType<typeof makeReference>>;
  /** A response for DELETE other than the default 204. */
  readonly onDelete?: () => unknown;
  readonly collections?: readonly unknown[];
}

/**
 * A stub that actually forgets. The catalogue is re-read after a removal, so a
 * fixed list would prove nothing about whether the plate really left; this one
 * drops the row on DELETE exactly as the backend does.
 */
function stubArchive({
  holds = [STILLPAGE, SPADE],
  onDelete,
  collections = [REFERENCE_STYLES],
}: ArchiveOptions = {}) {
  let live = [...holds];
  const deletes: StubRequest[] = [];
  const forget = (id: string) => {
    live = live.filter((reference) => reference.id !== id);
  };

  const routes: readonly StubRoute[] = [
    {
      method: "DELETE",
      path: DETAIL,
      handler: (request) => {
        deletes.push(request);
        if (onDelete) {
          return onDelete();
        }
        forget(request.pathname.split("/").at(-1) ?? "");
        return new Response(null, { status: 204 });
      },
    },
    {
      path: DETAIL,
      handler: ({ pathname }) => {
        const id = pathname.split("/").at(-1);
        const found = live.find((reference) => reference.id === id);
        return (
          found ??
          apiError(404, "REFERENCE_NOT_FOUND", "Reference not found")
        );
      },
    },
    {
      /*
       * Every slice in these tests holds the same two references, so the list
       * answers `live` whatever it is filtered by; what matters is that it is
       * re-read after a removal and no longer carries the deleted row.
       */
      path: LIST,
      handler: () => referencePage(live, { total: live.length }),
    },
    { path: /^\/design-types$/u, handler: () => [makeDesignType({ ...PRINT_TECH, referenceCount: live.length })] },
    {
      path: /^\/collections$/u,
      handler: () =>
        collections.map((collection) => ({
          ...(collection as Record<string, unknown>),
          referenceCount: live.length,
        })),
    },
    {
      path: /^\/stats$/u,
      handler: () => makeStats({ totalReferences: live.length }),
    },
  ];

  const api = stubApi(routes);
  return { api, deletes, forget, held: () => live };
}

afterEach(() => {
  clearPlateFocus();
});

const dialog = () => screen.getByRole("dialog");
const deleteRequests = (api: { readonly requests: readonly StubRequest[] }) =>
  api.requests.filter((request) => request.method === "DELETE");

/** Opens the sheet for STILLPAGE from the given catalogue route. */
async function openSheet(route: string, path = "/all") {
  const rendered = renderRoute(route, [path]);
  await screen.findByRole("dialog");
  await screen.findByRole("button", { name: /delete reference/i });
  return rendered;
}

describe("the delete action in the reference sheet", () => {
  it("prints DELETE REFERENCE in the loaded action row", async () => {
    stubArchive();
    await openSheet(`/reference/${STILLPAGE.id}`);

    const actions = dialog();
    expect(
      within(actions).getByRole("button", { name: /delete reference/i }),
    ).toBeInTheDocument();
    // It joins the existing row rather than replacing anything in it.
    expect(within(actions).getByRole("button", { name: /copy brief/i })).toBeInTheDocument();
    expect(
      within(actions).getByRole("button", { name: /copy image recipe/i }),
    ).toBeInTheDocument();
    expect(within(actions).getByRole("button", { name: /^close$/i })).toBeInTheDocument();
  });

  it("asks before it removes anything, and sends no request to do so", async () => {
    const { api } = stubArchive();
    const user = userEvent.setup();
    await openSheet(`/reference/${STILLPAGE.id}`);

    await user.click(screen.getByRole("button", { name: /delete reference/i }));

    expect(screen.getByText(/remove this reference\?/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeInTheDocument();
    expect(deleteRequests(api)).toHaveLength(0);
  });

  it("puts focus on CANCEL, so a reflexive Enter removes nothing", async () => {
    const { api } = stubArchive();
    const user = userEvent.setup();
    await openSheet(`/reference/${STILLPAGE.id}`);

    await user.click(screen.getByRole("button", { name: /delete reference/i }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^cancel$/i })).toHaveFocus(),
    );

    await user.keyboard("{Enter}");
    expect(deleteRequests(api)).toHaveLength(0);
  });

  it("restores the ordinary action row on CANCEL", async () => {
    const { api } = stubArchive();
    const user = userEvent.setup();
    await openSheet(`/reference/${STILLPAGE.id}`);

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByText(/remove this reference\?/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete reference/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy brief/i })).toBeInTheDocument();
    expect(deleteRequests(api)).toHaveLength(0);
  });

  it("sends DELETE to the reference's own address on the second press", async () => {
    const { api } = stubArchive();
    const user = userEvent.setup();
    await openSheet(`/reference/${STILLPAGE.id}`);

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteRequests(api)).toHaveLength(1));
    expect(deleteRequests(api)[0]?.pathname).toBe(`/references/${STILLPAGE.id}`);
  });

  it("takes one removal however many times DELETE is pressed", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { api } = stubArchive({
      onDelete: async () => {
        await held;
        return new Response(null, { status: 204 });
      },
    });
    const user = userEvent.setup();
    await openSheet(`/reference/${STILLPAGE.id}`);

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    // In flight: the control says so, and refuses to be pressed again.
    const deleting = await screen.findByRole("button", { name: /deleting/i });
    expect(deleting).toBeDisabled();
    expect(deleting).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeDisabled();

    await user.click(deleting);
    await user.click(deleting);

    release?.();
    await waitFor(() => expect(deleteRequests(api)).toHaveLength(1));
  });
});

describe("after a reference is removed", () => {
  it("closes the sheet and returns to the catalogue it was opened from", async () => {
    const { location } = await openSheetFrom("/all");
    await confirmDelete();

    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("returns to the design type the plate was opened from", async () => {
    const { location } = await openSheetFrom("/type/print-tech-paper");
    await confirmDelete();

    await waitFor(() =>
      expect(location().pathname).toBe("/type/print-tech-paper"),
    );
  });

  it("returns to a searched slice with the search still applied", async () => {
    const { location } = await openSheetFrom("/all?q=grain");
    await confirmDelete();

    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(location().search).toBe("?q=grain");
  });

  it("takes the plate out of the catalogue without a reload", async () => {
    /*
     * Asserted before the sheet opens: Radix hides the rest of the page from
     * assistive technology while the dialog is up, so the plate behind it is
     * deliberately unreachable by role until the sheet has gone.
     */
    await openSheetFrom("/all", (plate) => {
      expect(plate).toBeInTheDocument();
    });

    await confirmDelete();

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Stillpage" })).not.toBeInTheDocument(),
    );
    // The rest of the archive is untouched.
    expect(screen.getByRole("link", { name: "Spade" })).toBeInTheDocument();
  });

  it("brings the archive's counts down with it", async () => {
    await openSheetFrom("/all");
    await confirmDelete();

    // The catalogue's own marginalia; counts are padded to two digits.
    await waitFor(() =>
      expect(screen.getByText(/showing 01 of 01/i)).toBeInTheDocument(),
    );

    // And the rail, whose totals come from the stats and design-type reads.
    const rail = screen.getByRole("navigation", { name: /catalogue filters/i });
    await waitFor(() =>
      expect(within(rail).getByRole("link", { name: /^all/i })).toHaveTextContent(
        /^all\s*1$/iu,
      ),
    );
    expect(
      within(rail).getByRole("link", { name: /print-tech paper/i }),
    ).toHaveTextContent(/print-tech paper\s*1$/iu);
  });

  it("updates the collection view when the plate is removed from inside it", async () => {
    const { location } = await openSheetFrom("/collection/reference-styles");
    await confirmDelete();

    await waitFor(() =>
      expect(location().pathname).toBe("/collection/reference-styles"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Stillpage" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByText(/1 reference/i)).toBeInTheDocument());
  });
});

describe("when the removal does not go through", () => {
  it("keeps the sheet open, says what happened, and allows a retry", async () => {
    let fail = true;
    const { api } = stubArchive({
      onDelete: () =>
        fail
          ? apiError(500, "STORAGE_FAILURE", "The capture could not be removed.")
          : new Response(null, { status: 204 }),
    });
    const user = userEvent.setup();
    renderRoute(`/reference/${STILLPAGE.id}`, ["/all"]);
    await screen.findByRole("button", { name: /delete reference/i });

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not reach the local api|refused the removal/i);
    // Still open, still the same reference, and still answerable.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^delete$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^cancel$/i })).toBeEnabled();

    fail = false;
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(deleteRequests(api)).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("lets the reader back out of a failed removal", async () => {
    stubArchive({
      onDelete: () => apiError(500, "STORAGE_FAILURE", "Nope."),
    });
    const user = userEvent.setup();
    renderRoute(`/reference/${STILLPAGE.id}`, ["/all"]);
    await screen.findByRole("button", { name: /delete reference/i });

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));
    await screen.findByRole("alert");

    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete reference/i })).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("treats a reference the archive no longer holds as already gone", async () => {
    /*
     * Removed in another tab: the row is already gone from the archive, so the
     * delete answers 404 and the catalogue re-reads without it.
     */
    const { api, forget } = stubArchive({
      onDelete: () => {
        forget(STILLPAGE.id);
        return apiError(404, "REFERENCE_NOT_FOUND", "Reference not found");
      },
    });
    const user = userEvent.setup();
    const { location } = renderRoute(`/reference/${STILLPAGE.id}`, ["/all"]);
    await screen.findByRole("button", { name: /delete reference/i });

    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    // No error: the reader asked for it to be gone, and it is.
    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(deleteRequests(api)).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Stillpage" })).not.toBeInTheDocument(),
    );
  });
});

describe("a removed reference and the working selection", () => {
  it("drops the mark along with the plate", async () => {
    stubArchive();
    const user = userEvent.setup();
    renderRoute("/all");
    await screen.findByRole("link", { name: "Stillpage" });

    await user.click(screen.getByRole("button", { name: /select references/i }));
    await user.click(await screen.findByRole("checkbox", { name: /mark stillpage/i }));
    await user.click(screen.getByRole("checkbox", { name: /mark spade/i }));
    expect(screen.getByText(/marked 02 of 100/i)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Stillpage" }));
    await screen.findByRole("button", { name: /delete reference/i });
    await user.click(screen.getByRole("button", { name: /delete reference/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    // The removed plate leaves the selection; the other mark survives.
    await waitFor(() => expect(screen.getByText(/marked 01 of 100/i)).toBeInTheDocument());
  });
});

/* --- helpers ------------------------------------------------------------ */

let currentApi: ReturnType<typeof stubArchive> | undefined;

/** Opens STILLPAGE's sheet from `path`, the way a reader clicks a plate. */
async function openSheetFrom(
  path: string,
  inspectCatalogue?: (plate: HTMLElement) => void,
) {
  currentApi = stubArchive();
  const user = userEvent.setup();
  const rendered = renderRoute(path);
  const plate = await screen.findByRole("link", { name: "Stillpage" });
  inspectCatalogue?.(plate);
  await user.click(plate);
  await screen.findByRole("button", { name: /delete reference/i });
  return rendered;
}

async function confirmDelete() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: /delete reference/i }));
  await user.click(screen.getByRole("button", { name: /^delete$/i }));
  await waitFor(() =>
    expect(deleteRequests(currentApi!.api)).toHaveLength(1),
  );
}
