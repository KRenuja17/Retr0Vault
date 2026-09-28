import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeReference } from "@/components/catalogue/fixtures";
import { SIGNED_OUT_EVENT } from "@/lib/api/client";
import { resetDoorSequence } from "@/lib/vault/doorSequence";
import { apiError, referencePage, renderRoute, stubApi, TEST_SESSION } from "@/test/harness";

const PLATE = makeReference({ id: "aaaaaaaa-0000-4000-8000-000000000002", title: "Nightpage" });

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** A signed-in depositor whose session can be ended from the test. */
function vault() {
  let signedIn = true;
  const api = stubApi([
    { path: /^\/auth\/session$/u, handler: () => (signedIn ? TEST_SESSION : apiError(401, "AUTH_REQUIRED", "Sign in to open the vault")) },
    { path: /^\/references$/u, handler: () => (signedIn ? referencePage([PLATE]) : apiError(401, "AUTH_REQUIRED", "Sign in to open the vault")) },
  ]);
  return { api, endSession: () => { signedIn = false; } };
}

beforeEach(() => {
  reducedMotion(false);
  resetDoorSequence();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now() + 1e6), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = "";
});

const sleepDial = () => within(screen.getByRole("banner")).getByRole("button", { name: /sleep/i });

describe("putting the vault to sleep", () => {
  it("closes the front door over the page from the masthead's dial, keeps the session, and wakes where it left off", async () => {
    const { api } = vault();
    const { location } = renderRoute("/all?q=night");
    expect(await screen.findByRole("link", { name: "Nightpage" })).toBeInTheDocument();

    await userEvent.click(sleepDial());
    const door = await screen.findByRole("dialog", { name: "Retr0Vault" });
    // Still on the page it was put to sleep over, and still signed in.
    expect(location().pathname).toBe("/all");
    expect(location().search).toBe("?q=night");
    expect(document.querySelector("[class*=standby]")).toHaveTextContent("Asleep · tester");
    expect(api.requests.some((request) => request.pathname === "/auth/logout")).toBe(false);

    // The doors close in, meet, and the door is ready to be opened.
    const enter = within(door).getByRole("button", { name: /enter the vault/i });
    await waitFor(() => expect(enter).toHaveFocus(), { timeout: 4000 });
    await userEvent.click(enter);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
    expect(location().pathname).toBe("/all");
    expect(location().search).toBe("?q=night");
    expect(screen.getByRole("link", { name: "Nightpage" })).toBeInTheDocument();
  }, 15_000);

  it("wakes into the strong room when the session lapsed while the vault slept", async () => {
    const { endSession } = vault();
    const { location } = renderRoute("/all");
    expect(await screen.findByRole("link", { name: "Nightpage" })).toBeInTheDocument();

    await userEvent.click(sleepDial());
    const door = await screen.findByRole("dialog", { name: "Retr0Vault" });
    const enter = within(door).getByRole("button", { name: /enter the vault/i });
    await waitFor(() => expect(enter).toHaveFocus(), { timeout: 4000 });

    // Time passes; the session ends.
    endSession();
    const later = Date.now() + 5 * 60_000;
    vi.spyOn(Date, "now").mockReturnValue(later);
    await userEvent.click(enter);

    await waitFor(() => expect(location().pathname).toBe("/login"), { timeout: 5000 });
    expect(location().state).toMatchObject({ from: "/all" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 5000 });
    expect(screen.getByRole("heading", { name: "Present your credentials." })).toBeInTheDocument();
  }, 15_000);

  it("locks itself when the session ends inside the vault: the doors close onto the strong room", async () => {
    const { endSession } = vault();
    const { location } = renderRoute("/all");
    expect(await screen.findByRole("link", { name: "Nightpage" })).toBeInTheDocument();

    endSession();
    act(() => {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    });
    // The room stays in view while the doors close over it.
    expect(screen.getByRole("link", { name: "Nightpage" })).toBeInTheDocument();

    await waitFor(() => expect(location().pathname).toBe("/login"), { timeout: 5000 });
    expect(location().state).toMatchObject({ from: "/all", ended: true });
    expect(await screen.findByText(/the session ended and the vault locked itself/iu)).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector("[class*=doors]")).toBeNull());
  }, 15_000);

  it("closes the front door over the strong room from its own dial", async () => {
    stubApi([{ path: /^\/auth\/session$/u, handler: () => apiError(401, "AUTH_REQUIRED", "Sign in to open the vault") }]);
    const { location } = renderRoute("/login");
    await screen.findByRole("heading", { name: "Present your credentials." }, { timeout: 4000 });

    await userEvent.click(screen.getByRole("button", { name: "Front door" }));
    expect(await screen.findByRole("dialog", { name: "Retr0Vault" })).toBeInTheDocument();
    expect(location().pathname).toBe("/login");
    // Asleep without a depositor: nobody to wait for.
    expect(document.querySelector("[class*=standby]")).toHaveTextContent(/^\s*Asleep\s*$/u);
  });

  it("goes to sleep at once under reduced motion", async () => {
    reducedMotion(true);
    vault();
    renderRoute("/all");
    expect(await screen.findByRole("link", { name: "Nightpage" })).toBeInTheDocument();
    await userEvent.click(sleepDial());
    const door = await screen.findByRole("dialog", { name: "Retr0Vault" });
    expect(within(door).getByRole("button", { name: /enter the vault/i })).toHaveFocus();
  });
});
