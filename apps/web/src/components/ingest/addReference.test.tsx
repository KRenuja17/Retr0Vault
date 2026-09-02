import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeStats } from "@/components/catalogue/fixtures";

import { AddReferenceView } from "./AddReferenceView";
import {
  makeFile,
  makeStoredReference,
  renderIngest,
  stubApi,
} from "./testHarness";

const FILED = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000009",
  title: "Nightlife, Refined",
  analysisStatus: "pending",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the accession page end to end", () => {
  it("shows a plate in the ledger as awaiting analysis the moment it is filed", async () => {
    let filed = false;

    stubApi([
      {
        method: "POST",
        path: /^\/references\/image$/u,
        handler: () => {
          filed = true;
          return FILED;
        },
      },
      {
        path: /^\/stats$/u,
        handler: () =>
          makeStats({
            totalReferences: filed ? 1 : 0,
            pendingReferences: filed ? 1 : 0,
          }),
      },
      {
        path: /^\/references$/u,
        handler: ({ search }) => {
          if (search.get("status") === "failed") {
            return { items: [], page: 1, limit: 1, total: 0, totalPages: 1 };
          }
          const items = filed ? [FILED] : [];
          return {
            items,
            page: 1,
            limit: 12,
            total: items.length,
            totalPages: items.length,
          };
        },
      },
    ]);

    renderIngest(<AddReferenceView />);

    expect(await screen.findByText(/no references filed yet/i)).toBeInTheDocument();

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("nightlife.png", "image/png"),
    );
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));

    // The ledger list can only exist after the upload resolved and the list
    // query was invalidated and refetched.
    const ledger = await screen.findByRole("list", { name: /accession ledger/i });
    const [row] = within(ledger).getAllByRole("listitem");
    expect(within(row!).getByRole("link", { name: "Nightlife, Refined" }))
      .toBeInTheDocument();
    expect(within(row!).getByText(/awaiting analysis/i)).toBeInTheDocument();

    // And the pending count moved with it.
    const pending = screen.getByRole("group", { name: "Pending" });
    expect(await within(pending).findByText("01")).toBeInTheDocument();
  });

  it("carries both lanes and the desk on one page", async () => {
    stubApi();
    renderIngest(<AddReferenceView />);

    expect(
      screen.getByRole("heading", { name: /file an image reference/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /capture a public page/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: /pending analysis/i }),
    ).toBeInTheDocument();
    expect(await screen.findByText(/no references filed yet/i)).toBeInTheDocument();
  });
});
