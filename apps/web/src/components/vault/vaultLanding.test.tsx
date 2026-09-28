import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeReference, makeStats } from "@/components/catalogue/fixtures";
import { referencePage, renderRoute, stubApi } from "@/test/harness";

const PLATE = makeReference({ id: "aaaaaaaa-0000-4000-8000-000000000001", title: "Stillpage" });

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

function archive() {
  stubApi([
    { path: /^\/references$/u, handler: () => referencePage([PLATE]) },
    // The front door's strip and counters: the public showcase of the whole archive.
    {
      path: /^\/showcase$/u,
      handler: () => ({
        references: [{ id: PLATE.id, title: PLATE.title, updatedAt: PLATE.updatedAt }],
        counts: { plates: 11, motionStudies: 2, designTypes: 2 },
      }),
    },
    {
      path: /^\/stats$/u,
      handler: () => makeStats({
        totalReferences: 11,
        motionStudies: { total: 2, pending: 0, analyzed: 2, manual: 0, failed: 0 },
        countsByDesignType: [
          { id: "11111111-1111-4111-8111-111111111111", name: "Print-Tech Paper", slug: "print-tech-paper", referenceCount: 1 },
          { id: "22222222-2222-4222-8222-222222222222", name: "Dither Mono", slug: "dither-mono", referenceCount: 3 },
          { id: "33333333-3333-4333-8333-333333333333", name: "Unused", slug: "unused", referenceCount: 0 },
        ],
      }),
    },
  ]);
}

beforeEach(() => {
  reducedMotion(false);
  // Every frame lands at the end of its tween, so a dial turn completes in one step.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now() + 1e6), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = "";
});

describe("the vault's front door", () => {
  it("shuts the vault over the catalogue at the index", async () => {
    archive();
    const { location } = renderRoute("/");
    const door = await screen.findByRole("dialog", { name: "Retr0Vault" });
    // The door stays up while the session is read, then the catalogue is put behind it.
    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(within(door).getByRole("button", { name: /enter the vault/i })).toHaveFocus();
    // The catalogue is already there underneath, and out of reach until the doors open.
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(document.querySelector("#catalogue")?.closest("[inert]")).not.toBeNull();
    expect(document.documentElement.style.overflow).toBe("hidden");
    await waitFor(() => expect(door).toHaveAccessibleDescription(/11 plates, 2 motion studies/u));
  });

  it("dials the archive's own combination, then opens onto the catalogue", async () => {
    archive();
    const { location } = renderRoute("/");
    const door = await screen.findByRole("dialog");
    // Plates, motion studies, and design types that hold a plate.
    await waitFor(() => expect(door).toHaveAccessibleDescription(/11 plates/u));

    await userEvent.click(within(door).getByRole("button", { name: /enter the vault/i }));

    await waitFor(() => {
      const locked = [...door.querySelectorAll("[class*=doorLeft] [class*=slotLocked]")].map((slot) => slot.textContent);
      expect(locked).toEqual(["11", "02", "02"]);
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 4000 });
    // Entered before the session was read, the catalogue follows the doors.
    await waitFor(() => expect(location().pathname).toBe("/all"));
    expect(location().state).toBeNull();
    expect(document.querySelector("[inert]")).toBeNull();
    expect(document.documentElement.style.overflow).toBe("");
  });

  it("opens at once under reduced motion", async () => {
    reducedMotion(true);
    archive();
    renderRoute("/");
    await userEvent.click(await screen.findByRole("button", { name: /enter the vault/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
  });

  it("can be skipped, by the button or by Escape", async () => {
    archive();
    renderRoute("/");
    await userEvent.click(await screen.findByRole("button", { name: /^skip$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    renderRoute("/");
    await screen.findAllByRole("dialog");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("goes straight in from a direct link, and the footer leads back to the door", async () => {
    archive();
    const { location } = renderRoute("/all");
    expect(await screen.findByRole("link", { name: "Stillpage" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    // The footer's dial puts the vault to sleep behind its front door.
    await userEvent.click(screen.getByRole("button", { name: "Front door" }));
    expect(await screen.findByRole("dialog", { name: "Retr0Vault" })).toBeInTheDocument();
    expect(location().pathname).toBe("/all");
  });
});
