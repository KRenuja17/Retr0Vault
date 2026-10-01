import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { apiError, renderRoute, stubApi, TEST_SESSION } from "@/test/harness";
import { nextDoorSplit, resetDoorSequence } from "@/lib/vault/doorSequence";

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

/** No session: the API refuses the vault's rooms until a sign-in succeeds. */
function signedOut(login: (body: unknown) => unknown = () => TEST_SESSION) {
  let signedIn = false;
  return stubApi([
    { path: /^\/auth\/session$/u, handler: () => (signedIn ? TEST_SESSION : apiError(401, "AUTH_REQUIRED", "Sign in to open the vault")) },
    {
      method: "POST",
      path: /^\/auth\/login$/u,
      handler: ({ body }) => {
        const result = login(body);
        if (!(result instanceof Response)) signedIn = true;
        return result;
      },
    },
    { method: "POST", path: /^\/auth\/logout$/u, handler: () => new Response(null, { status: 204 }) },
  ]);
}

beforeEach(() => {
  reducedMotion(false);
  resetDoorSequence();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now() + 1e6), 0));
  vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.style.overflow = "";
});

async function present(username: string, password: string) {
  await userEvent.type(await screen.findByLabelText(/depositor/i, {}, { timeout: 4000 }), username);
  await userEvent.type(screen.getByLabelText(/^combination/i), password);
  await userEvent.click(screen.getByRole("button", { name: /open the strong room/i }));
}

describe("the strong room", () => {
  it("guards the vault: a room reached without a session sends the reader to the strong room", async () => {
    const api = signedOut();
    const { location } = renderRoute("/all");
    expect(await screen.findByRole("heading", { name: "Present your credentials." }, { timeout: 4000 })).toBeInTheDocument();
    expect(location().pathname).toBe("/login");
    expect(location().state).toMatchObject({ from: "/all" });
    expect(api.requests.some((request) => request.pathname === "/references")).toBe(false);
  });

  it("stands behind the front door for a visitor", async () => {
    signedOut();
    const { location } = renderRoute("/");
    expect(await screen.findByRole("dialog", { name: "Retr0Vault" })).toBeInTheDocument();
    await waitFor(() => expect(location().pathname).toBe("/login"), { timeout: 4000 });
    // The route changes before its screen finishes mounting behind the front door.
    expect(await screen.findByRole("heading", { name: "Present your credentials.", hidden: true }, { timeout: 4000 })).toBeInTheDocument();
  });

  it("reads the name, then shuts its lens while the combination is typed, one tumbler per character", async () => {
    signedOut();
    renderRoute("/login");
    const readout = () => document.querySelector("[class*=readout]")!.textContent;
    await userEvent.type(await screen.findByLabelText(/depositor/i), "Krenuja");
    expect(readout()).toMatch(/lens open/u);
    const combination = screen.getByLabelText(/^combination/i);
    await userEvent.type(combination, "Retr0");
    expect(readout()).toMatch(/Tumblers 05 · lens shut/u);
    expect(combination).toHaveAttribute("type", "password");
    await userEvent.click(screen.getByRole("button", { name: /reveal/i }));
    expect(combination).toHaveAttribute("type", "text");
    expect(readout()).toMatch(/lens ajar/u);
  });

  it("stamps a wrong combination denied, says so, and wipes it", async () => {
    signedOut(() => apiError(401, "INVALID_CREDENTIALS", "Those credentials do not open this vault. 4 tries left before a pause."));
    const { location } = renderRoute("/login");
    await present("Krenuja", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("4 tries left");
    expect(document.querySelector("[class*=stamp]")).toHaveTextContent(/access denied/i);
    await waitFor(() => expect(screen.getByLabelText(/^combination/i)).toHaveValue(""), { timeout: 3000 });
    expect(screen.getByLabelText(/^combination/i)).toHaveFocus();
    expect(location().pathname).toBe("/login");
  });

  it("pauses after too many tries, and counts the pause down", async () => {
    signedOut(() => apiError(429, "AUTH_THROTTLED", "Too many failed attempts; try again in 30 seconds"));
    renderRoute("/login");
    await present("Krenuja", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent(/paused.*00:30/u);
    expect(screen.getByRole("button", { name: /open the strong room/i })).toBeDisabled();
  });

  it("asks for what is missing instead of trying", async () => {
    const api = signedOut();
    renderRoute("/login");
    await userEvent.click(await screen.findByRole("button", { name: /open the strong room/i }));
    expect(screen.getByText(/needs a depositor's name/u)).toBeInTheDocument();
    expect(screen.getByLabelText(/depositor/i)).toHaveFocus();
    expect(api.requests.some((request) => request.pathname === "/auth/login")).toBe(false);
  });

  it("grants access, then opens onto the catalogue, the doors splitting up and down after the front door's left and right", async () => {
    const api = signedOut();
    // The front door took this visit's first turn.
    expect(nextDoorSplit()).toBe("left-right");
    const { location } = renderRoute("/login", ["/all"]);
    await present("Krenuja", "Retr017");
    expect(await screen.findByText(/access granted/i, { selector: "[class*=stampText]" })).toBeInTheDocument();
    const doors = await waitFor(() => {
      const found = document.querySelector("[class*=upDown]");
      expect(found).not.toBeNull();
      return found!;
    }, { timeout: 4000 });
    expect(doors.getAttribute("aria-hidden")).toBe("true");
    await waitFor(() => expect(location().pathname).toBe("/all"), { timeout: 4000 });
    expect(api.requests.find((request) => request.pathname === "/auth/login")?.body).toEqual({ username: "Krenuja", password: "Retr017" });
    await waitFor(() => expect(screen.getByText(/depositor · tester/i)).toBeInTheDocument(), { timeout: 4000 });
    await waitFor(() => expect(document.querySelector("[class*=upDown]")).toBeNull(), { timeout: 4000 });
  }, 15_000);

  it("locks the vault behind the depositor, back at the strong room", async () => {
    reducedMotion(true);
    const api = stubApi([{ method: "POST", path: /^\/auth\/logout$/u, handler: () => new Response(null, { status: 204 }) }]);
    const { location } = renderRoute("/all");
    const masthead = await screen.findByRole("banner");
    await userEvent.click(within(masthead).getByRole("button", { name: /lock the vault/i }));
    await waitFor(() => expect(location().pathname).toBe("/login"));
    expect(api.requests.some((request) => request.method === "POST" && request.pathname === "/auth/logout")).toBe(true);
    expect(await screen.findByRole("heading", { name: "Present your credentials." }, { timeout: 4000 })).toBeInTheDocument();
  });
});
