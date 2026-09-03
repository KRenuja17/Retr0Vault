import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router-dom";

import { routes } from "./router";

function renderAt(path: string) {
  const router = createMemoryRouter([...routes], { initialEntries: [path] });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

/** Every shell test runs with the API down; the shell must still render. */
function stubOfflineApi() {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("route shell", () => {
  it("redirects the index to the catalogue", () => {
    stubOfflineApi();
    renderAt("/");
    expect(
      screen.getByRole("navigation", { name: /catalogue filters/i }),
    ).toBeInTheDocument();
  });

  it("renders the masthead and marginalia on every route", () => {
    stubOfflineApi();
    renderAt("/all");
    expect(screen.getByRole("link", { name: /retr0vault/i })).toBeInTheDocument();
    expect(screen.getByText(/web 4610 · api 4611/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to catalogue/i })).toBeInTheDocument();
  });

  it("filters the catalogue by the design-type slug in the URL", async () => {
    const fetchMock = stubOfflineApi();
    renderAt("/type/dither-mono");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("designType=dither-mono"))).toBe(true);
    });
  });

  it("filters the catalogue by the collection slug in the URL", async () => {
    const fetchMock = stubOfflineApi();
    renderAt("/collection/reference-styles");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(urls.some((url) => url.includes("collection=reference-styles"))).toBe(true);
    });
  });

  it("asks the catalogue for plate numbers", async () => {
    const fetchMock = stubOfflineApi();
    renderAt("/all");

    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((call) => String(call[0]));
      expect(
        urls.some((url) => url.includes("includeCatalogueIndex=true")),
      ).toBe(true);
    });
  });

  /*
   * `/foundation` was the F1 specimen sheet — a development surface, never part
   * of the product. It is gone, and the address is now nothing special: it
   * falls through to the same not-found plate as any other unknown route.
   */
  it("resolves the retired /foundation address through the not-found plate", () => {
    stubOfflineApi();
    renderAt("/foundation");
    expect(
      screen.getByRole("heading", { name: /no such plate/i }),
    ).toBeInTheDocument();
  });

  it("prints no visual-system link in the marginalia", () => {
    stubOfflineApi();
    renderAt("/all");
    expect(
      screen.queryByRole("link", { name: /visual system/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/visual system/i)).not.toBeInTheDocument();
  });

  it("falls through to the not-found plate", () => {
    stubOfflineApi();
    renderAt("/nowhere");
    expect(screen.getByRole("heading", { name: /no such plate/i })).toBeInTheDocument();
  });
});
