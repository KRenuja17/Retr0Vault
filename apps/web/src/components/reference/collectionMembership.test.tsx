import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  makeCollectionResponse,
  makeStoredReference,
  renderIngest,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";

import { ReferenceModal } from "./ReferenceModal";

const REFERENCE_STYLES = makeCollectionResponse({
  id: "33333333-3333-4333-8333-333333333333",
  slug: "reference-styles",
  name: "Reference Styles",
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

const REFERENCE_ID = "aaaaaaaa-0000-4000-8000-000000000001";

const MEMBERSHIP_ROUTE = /^\/collections\/[^/]+\/references\/[^/]+$/u;

function reference(collectionIds: readonly string[]) {
  return makeStoredReference({
    id: REFERENCE_ID,
    title: "Stillpage",
    designThesis: "A thesis.",
    imageRecipe: "[SUBJECT] on warm paper.",
    collectionIds: [...collectionIds],
  });
}

function referenceRoute(pages: () => unknown): StubRoute {
  return { path: /^\/references\/[^/]+$/u, handler: pages };
}

function membershipRequests(
  requests: readonly StubRequest[],
  method: string,
): readonly StubRequest[] {
  return requests.filter(
    (request) => request.method === method && MEMBERSHIP_ROUTE.test(request.pathname),
  );
}

/** The membership row for one collection, addressed by its own list item. */
function rowFor(name: string): HTMLElement {
  const list = screen.getByRole("list", { name: /collection membership/i });
  const row = within(list)
    .getAllByRole("listitem")
    .find((item) => within(item).queryByText(name) !== null);
  if (row === undefined) {
    throw new Error(`No membership row for ${name}`);
  }
  return row;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collection membership on a reference sheet", () => {
  it("marks the collections the reference already belongs to", async () => {
    stubApi([
      { path: /^\/collections$/u, handler: () => [REFERENCE_STYLES, TYPE_STUDIES] },
      referenceRoute(() => reference([REFERENCE_STYLES.id])),
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    // The list exists only once both the reference and the collections resolve.
    await screen.findByRole("list", { name: /collection membership/i });

    expect(
      within(rowFor("Reference Styles")).getByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
    expect(
      within(rowFor("Type Studies")).getByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument();
  });

  it("adds the reference to a collection and flips the row", async () => {
    let member = false;
    const api = stubApi([
      {
        path: /^\/collections$/u,
        handler: () => [
          REFERENCE_STYLES,
          { ...TYPE_STUDIES, referenceCount: member ? 4 : 3 },
        ],
      },
      referenceRoute(() => reference(member ? [TYPE_STUDIES.id] : [])),
      {
        method: "POST",
        path: MEMBERSHIP_ROUTE,
        handler: () => {
          member = true;
          return new Response(null, { status: 204 });
        },
      },
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    await screen.findByRole("list", { name: /collection membership/i });
    await userEvent.click(
      within(rowFor("Type Studies")).getByRole("button", { name: /^add$/i }),
    );

    // REMOVE can only appear once the re-read reference reports membership.
    expect(
      await within(rowFor("Type Studies")).findByRole("button", { name: /^remove$/i }),
    ).toBeInTheDocument();
    // And the collection's own live count moved with it.
    expect(within(rowFor("Type Studies")).getByText("4")).toBeInTheDocument();

    const sent = membershipRequests(api.requests, "POST");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe(
      `/collections/${TYPE_STUDIES.id}/references/${REFERENCE_ID}`,
    );
  });

  it("removes the reference from a collection", async () => {
    let member = true;
    const api = stubApi([
      { path: /^\/collections$/u, handler: () => [REFERENCE_STYLES] },
      referenceRoute(() => reference(member ? [REFERENCE_STYLES.id] : [])),
      {
        method: "DELETE",
        path: MEMBERSHIP_ROUTE,
        handler: () => {
          member = false;
          return new Response(null, { status: 204 });
        },
      },
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    await screen.findByRole("list", { name: /collection membership/i });
    await userEvent.click(
      within(rowFor("Reference Styles")).getByRole("button", { name: /^remove$/i }),
    );

    expect(
      await within(rowFor("Reference Styles")).findByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument();

    const sent = membershipRequests(api.requests, "DELETE");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.pathname).toBe(
      `/collections/${REFERENCE_STYLES.id}/references/${REFERENCE_ID}`,
    );
  });

  it("reports a membership change the archive refused", async () => {
    const api = stubApi([
      { path: /^\/collections$/u, handler: () => [TYPE_STUDIES] },
      referenceRoute(() => reference([])),
      {
        method: "POST",
        path: MEMBERSHIP_ROUTE,
        handler: () =>
          new Response(
            JSON.stringify({
              error: {
                code: "COLLECTION_NOT_FOUND",
                message: "Collection not found",
                statusCode: 404,
              },
              requestId: "req-test",
            }),
            { status: 404, headers: { "Content-Type": "application/json" } },
          ),
      },
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    await screen.findByRole("list", { name: /collection membership/i });
    await userEvent.click(screen.getByRole("button", { name: /^add$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/collection not found/i);
    // The row is unchanged: nothing was added.
    expect(
      within(rowFor("Type Studies")).getByRole("button", { name: /^add$/i }),
    ).toBeInTheDocument();
    expect(membershipRequests(api.requests, "POST")).toHaveLength(1);
  });

  it("says so when no collections exist to file the reference into", async () => {
    stubApi([
      { path: /^\/collections$/u, handler: () => [] },
      referenceRoute(() => reference([])),
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    expect(
      await screen.findByText(/no collections exist yet/i),
    ).toBeInTheDocument();
  });

  it("reports collections it could not read without breaking the sheet", async () => {
    stubApi([
      {
        path: /^\/collections$/u,
        handler: () =>
          new Response("Internal Server Error", {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          }),
      },
      referenceRoute(() => reference([])),
    ]);
    renderIngest(<ReferenceModal referenceId={REFERENCE_ID} onClose={() => undefined} />);

    /*
     * The two queries settle independently, so this waits on the collections
     * failure itself — the reference resolving says nothing about it.
     */
    expect(
      await screen.findByText(/collections could not be read/i),
    ).toBeInTheDocument();
    // And the sheet around it still reads correctly.
    expect(screen.getByText("[SUBJECT]")).toBeInTheDocument();
  });
});
