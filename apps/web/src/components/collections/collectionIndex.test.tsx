import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  apiError,
  makeCollectionResponse,
  renderIngest,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";

import { CollectionIndex } from "./CollectionIndex";

const REFERENCE_STYLES = makeCollectionResponse({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
  description: "The default pinned collection.",
  isPinned: true,
  referenceCount: 18,
});

const TYPE_STUDIES = makeCollectionResponse({
  id: "44444444-4444-4444-8444-444444444444",
  slug: "type-studies",
  name: "Type Studies",
  sortOrder: 1,
  referenceCount: 3,
});

function collectionsRoute(pages: () => unknown): StubRoute {
  return { path: /^\/collections$/u, handler: pages };
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

/** The register row for one collection, addressed by its list entry. */
function rowFor(name: string): HTMLElement {
  const register = screen.getByRole("list", { name: /collection register/i });
  const row = within(register)
    .getAllByRole("listitem")
    .find((item) => within(item).queryByRole("link", { name }) !== null);
  if (row === undefined) {
    throw new Error(`No register row for ${name}`);
  }
  return row;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("reading the register", () => {
  it("lists every collection with its live count and address", async () => {
    stubApi([collectionsRoute(() => [REFERENCE_STYLES, TYPE_STUDIES])]);
    renderIngest(<CollectionIndex />);

    // The row exists only once the collection list has resolved.
    await screen.findByRole("link", { name: "Reference Styles" });

    const pinned = rowFor("Reference Styles");
    expect(within(pinned).getByText(/18 references/i)).toBeInTheDocument();
    expect(within(pinned).getByText(/^pinned$/i)).toBeInTheDocument();
    expect(within(pinned).getByText("/collection/reference-styles")).toBeInTheDocument();

    const unpinned = rowFor("Type Studies");
    expect(within(unpinned).getByText(/3 references/i)).toBeInTheDocument();
    expect(within(unpinned).queryByText(/^pinned$/i)).toBeNull();
  });

  it("keeps Reference Styles reachable as the default pinned collection", async () => {
    stubApi([collectionsRoute(() => [REFERENCE_STYLES])]);
    renderIngest(<CollectionIndex />);

    expect(await screen.findByRole("link", { name: "Reference Styles" })).toHaveAttribute(
      "href",
      "/collection/reference-styles",
    );
  });

  it("says the register is empty rather than showing nothing", async () => {
    stubApi([collectionsRoute(() => [])]);
    renderIngest(<CollectionIndex />);

    expect(await screen.findByText(/no collections yet/i)).toBeInTheDocument();
  });

  it("reports a register it could not read", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderIngest(<CollectionIndex />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not reach the local api/i,
    );
  });
});

describe("creating a collection", () => {
  it("sends the name and description, then shows the new row", async () => {
    let created = false;
    const api = stubApi([
      collectionsRoute(() => (created ? [REFERENCE_STYLES, TYPE_STUDIES] : [REFERENCE_STYLES])),
      {
        method: "POST",
        path: /^\/collections$/u,
        handler: () => {
          created = true;
          return TYPE_STUDIES;
        },
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Reference Styles" });

    await userEvent.type(screen.getByLabelText(/new collection/i), "Type Studies");
    await userEvent.type(screen.getByLabelText(/^description$/i), "Serif experiments");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    // The new row can only exist after the list was invalidated and refetched.
    expect(await screen.findByRole("link", { name: "Type Studies" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      /Type Studies was created at \/collection\/type-studies/i,
    );

    const sent = requestsTo(api.requests, "POST", /^\/collections$/u);
    expect(sent).toHaveLength(1);
    // The slug is the backend's to derive; the client never invents one.
    expect(sent[0]?.body).toEqual({
      name: "Type Studies",
      description: "Serif experiments",
      isPinned: false,
    });
  });

  it("refuses an empty name without sending anything", async () => {
    const api = stubApi([collectionsRoute(() => [REFERENCE_STYLES])]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Reference Styles" });
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/a collection needs a name/i)).toBeInTheDocument();
    expect(requestsTo(api.requests, "POST", /^\/collections$/u)).toHaveLength(0);
  });

  it("reports a slug the archive already holds", async () => {
    stubApi([
      collectionsRoute(() => [REFERENCE_STYLES]),
      {
        method: "POST",
        path: /^\/collections$/u,
        handler: () =>
          apiError(
            409,
            "COLLECTION_SLUG_CONFLICT",
            "A collection with slug 'reference-styles' already exists",
          ),
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Reference Styles" });
    await userEvent.type(screen.getByLabelText(/new collection/i), "Reference Styles");
    await userEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  });
});

describe("renaming a collection", () => {
  it("sends the new name and shows it once the register is re-read", async () => {
    let renamed = false;
    const RENAMED = { ...TYPE_STUDIES, name: "Typography Studies" };
    const api = stubApi([
      collectionsRoute(() => [renamed ? RENAMED : TYPE_STUDIES]),
      {
        method: "PATCH",
        path: /^\/collections\/[^/]+$/u,
        handler: () => {
          renamed = true;
          return RENAMED;
        },
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^rename$/i }));

    const field = await screen.findByLabelText(/^name$/i);
    await userEvent.clear(field);
    await userEvent.type(field, "Typography Studies");
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(
      await screen.findByRole("link", { name: "Typography Studies" }),
    ).toBeInTheDocument();

    const sent = requestsTo(api.requests, "PATCH", /^\/collections\/[^/]+$/u);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe(`/collections/${TYPE_STUDIES.id}`);
    // The slug is left alone so an address already in use keeps working.
    expect(sent[0]?.body).toEqual({ name: "Typography Studies", description: "" });
  });

  it("refuses to save an empty name", async () => {
    const api = stubApi([collectionsRoute(() => [TYPE_STUDIES])]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    await userEvent.clear(await screen.findByLabelText(/^name$/i));
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/a collection needs a name/i)).toBeInTheDocument();
    expect(requestsTo(api.requests, "PATCH", /^\/collections\/[^/]+$/u)).toHaveLength(0);
  });

  it("abandons the edit on cancel", async () => {
    const api = stubApi([collectionsRoute(() => [TYPE_STUDIES])]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^rename$/i }));
    await userEvent.type(await screen.findByLabelText(/^name$/i), " and more");
    await userEvent.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Type Studies" })).toBeInTheDocument();
    expect(requestsTo(api.requests, "PATCH", /^\/collections\/[^/]+$/u)).toHaveLength(0);
  });
});

describe("pinning a collection", () => {
  it("pins an unpinned collection so it reaches the filter rail", async () => {
    let pinned = false;
    const api = stubApi([
      collectionsRoute(() => [pinned ? { ...TYPE_STUDIES, isPinned: true } : TYPE_STUDIES]),
      {
        method: "PATCH",
        path: /^\/collections\/[^/]+$/u,
        handler: () => {
          pinned = true;
          return { ...TYPE_STUDIES, isPinned: true };
        },
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^pin$/i }));

    // The control flips only once the re-read register says it is pinned.
    expect(await screen.findByRole("button", { name: /^unpin$/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/pinned to the filter rail/i);
    expect(
      requestsTo(api.requests, "PATCH", /^\/collections\/[^/]+$/u)[0]?.body,
    ).toEqual({ isPinned: true });
  });

  it("unpins a pinned collection", async () => {
    const api = stubApi([
      collectionsRoute(() => [REFERENCE_STYLES]),
      {
        method: "PATCH",
        path: /^\/collections\/[^/]+$/u,
        handler: () => ({ ...REFERENCE_STYLES, isPinned: false }),
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Reference Styles" });
    await userEvent.click(screen.getByRole("button", { name: /^unpin$/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(/no longer pinned/i);
    expect(
      requestsTo(api.requests, "PATCH", /^\/collections\/[^/]+$/u)[0]?.body,
    ).toEqual({ isPinned: false });
  });
});

describe("deleting a collection", () => {
  it("asks first, then removes the row once the register is re-read", async () => {
    let deleted = false;
    const api = stubApi([
      collectionsRoute(() => (deleted ? [REFERENCE_STYLES] : [REFERENCE_STYLES, TYPE_STUDIES])),
      {
        method: "DELETE",
        path: /^\/collections\/[^/]+$/u,
        handler: () => {
          deleted = true;
          return new Response(null, { status: 204 });
        },
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(
      within(rowFor("Type Studies")).getByRole("button", { name: /^delete$/i }),
    );

    // Nothing is sent on the first press; the row asks to be sure.
    expect(await screen.findByText(/delete type studies\?/i)).toBeInTheDocument();
    expect(requestsTo(api.requests, "DELETE", /^\/collections\/[^/]+$/u)).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /delete it/i }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      /Type Studies was deleted/i,
    );
    expect(screen.queryByRole("link", { name: "Type Studies" })).toBeNull();
    expect(screen.getByRole("link", { name: "Reference Styles" })).toBeInTheDocument();

    const sent = requestsTo(api.requests, "DELETE", /^\/collections\/[^/]+$/u);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe(`/collections/${TYPE_STUDIES.id}`);
  });

  it("keeps the collection when the confirmation is refused", async () => {
    const api = stubApi([collectionsRoute(() => [TYPE_STUDIES])]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^keep$/i }));

    expect(screen.queryByText(/delete type studies\?/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Type Studies" })).toBeInTheDocument();
    expect(requestsTo(api.requests, "DELETE", /^\/collections\/[^/]+$/u)).toHaveLength(0);
  });

  it("reports a deletion the archive refused", async () => {
    stubApi([
      collectionsRoute(() => [TYPE_STUDIES]),
      {
        method: "DELETE",
        path: /^\/collections\/[^/]+$/u,
        handler: () =>
          apiError(409, "COLLECTION_IN_USE", "Collection cannot be deleted"),
      },
    ]);
    renderIngest(<CollectionIndex />);

    await screen.findByRole("link", { name: "Type Studies" });
    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await userEvent.click(await screen.findByRole("button", { name: /delete it/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /collection cannot be deleted/i,
    );
  });
});
