import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { routes } from "./router";

function renderAt(path: string) {
  const router = createMemoryRouter([...routes], { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("route shell", () => {
  it("redirects the index to the catalogue", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/");
    expect(screen.getByText(/route · \/all/i)).toBeInTheDocument();
  });

  it("renders the masthead and marginalia on every route", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/all");
    expect(screen.getByRole("link", { name: /retr0vault/i })).toBeInTheDocument();
    expect(screen.getByText(/web 4610 · api 4611/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to catalogue/i })).toBeInTheDocument();
  });

  it("resolves the design-type slug", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/type/dither-mono");
    expect(screen.getByRole("heading", { name: /dither-mono/i })).toBeInTheDocument();
  });

  it("resolves the collection slug", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/collection/reference-styles");
    expect(
      screen.getByRole("heading", { name: /reference-styles/i }),
    ).toBeInTheDocument();
  });

  it("renders the visual system specimen sheet", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/foundation");
    expect(screen.getByRole("heading", { name: /paper, rule, plate/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open modal surface/i })).toBeInTheDocument();
  });

  it("falls through to the not-found plate", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderAt("/nowhere");
    expect(screen.getByRole("heading", { name: /no such plate/i })).toBeInTheDocument();
  });
});
