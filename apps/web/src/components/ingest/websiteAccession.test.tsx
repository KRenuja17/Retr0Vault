import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WebsiteAccession } from "./WebsiteAccession";
import {
  apiError,
  makeStoredReference,
  renderIngest,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";

const CAPTURED = makeStoredReference({
  id: "bbbbbbbb-0000-4000-8000-000000000001",
  title: "example.com",
  sourceType: "website",
  sourceUrl: "https://example.com/",
  analysisStatus: "pending",
});

const CAPTURE_ROUTE = /^\/references\/url$/u;

function captureRoute(handler: StubRoute["handler"]): StubRoute {
  return { method: "POST", path: CAPTURE_ROUTE, handler };
}

function captures(requests: readonly StubRequest[]): readonly StubRequest[] {
  return requests.filter(
    (request) => request.method === "POST" && CAPTURE_ROUTE.test(request.pathname),
  );
}

async function submitAddress(address: string) {
  await userEvent.type(screen.getByLabelText(/^address$/i), address);
  await userEvent.click(screen.getByRole("button", { name: /capture this site/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capturing a website", () => {
  it("captures an address and files the result as awaiting analysis", async () => {
    const api = stubApi([captureRoute(() => CAPTURED)]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    const outcome = await screen.findByRole("status");
    expect(outcome).toHaveTextContent("example.com");
    expect(outcome).toHaveTextContent(/awaiting analysis/i);
    expect(outcome).toHaveTextContent(/plate capture/i);

    expect(captures(api.requests)).toHaveLength(1);
    expect(captures(api.requests)[0]?.body).toEqual({
      url: "https://example.com",
      fullPage: false,
    });
  });

  it("carries the optional title and the full-page request", async () => {
    const api = stubApi([captureRoute(() => CAPTURED)]);
    renderIngest(<WebsiteAccession />);

    await userEvent.type(screen.getByLabelText(/^address$/i), "https://example.com");
    await userEvent.type(screen.getByLabelText(/^title$/i), "Example");
    await userEvent.click(screen.getByLabelText(/full page/i));
    await userEvent.click(screen.getByRole("button", { name: /capture this site/i }));
    await screen.findByRole("status");

    expect(captures(api.requests)[0]?.body).toEqual({
      url: "https://example.com",
      title: "Example",
      fullPage: true,
    });
  });

  it("shows the capture running against its real budget", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubApi([
      captureRoute(async () => {
        await held;
        return CAPTURED;
      }),
    ]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    // Progress exists only while the capture request is actually in flight.
    const progress = await screen.findByRole("status");
    expect(progress).toHaveTextContent(/capturing/i);
    expect(progress).toHaveTextContent(/00s of 45s/i);

    release();
    // OPEN THE PLATE exists only in the outcome for a stored reference, so it
    // cannot be satisfied by the progress panel that is still on screen.
    expect(
      await screen.findByRole("link", { name: /open the plate/i }),
    ).toBeInTheDocument();
  });

  it("does not start a second capture while one is running", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = stubApi([
      captureRoute(async () => {
        await held;
        return CAPTURED;
      }),
    ]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    const running = await screen.findByRole("button", { name: /^capturing$/i });
    expect(running).toBeDisabled();
    await userEvent.click(running);

    release();
    await screen.findByRole("link", { name: /open the plate/i });
    expect(captures(api.requests)).toHaveLength(1);
  });
});

describe("refusing an address the capture route would reject", () => {
  it("asks for a complete address rather than sending a bare hostname", async () => {
    const api = stubApi([captureRoute(() => CAPTURED)]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("example.com");

    expect(
      await screen.findByText(/include https:\/\/ at the front/i),
    ).toBeInTheDocument();
    expect(captures(api.requests)).toHaveLength(0);
  });

  it("refuses a non-standard port, which capture does not allow", async () => {
    const api = stubApi([captureRoute(() => CAPTURED)]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com:8443/path");

    expect(await screen.findByText(/remove the port/i)).toBeInTheDocument();
    expect(captures(api.requests)).toHaveLength(0);
  });

  it("refuses an address carrying credentials", async () => {
    const api = stubApi([captureRoute(() => CAPTURED)]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://user:secret@example.com");

    expect(await screen.findByText(/credentials/i)).toBeInTheDocument();
    expect(captures(api.requests)).toHaveLength(0);
  });
});

describe("when a capture fails", () => {
  it("explains a timeout and says nothing was saved", async () => {
    stubApi([
      captureRoute(() =>
        apiError(
          504,
          "CAPTURE_TIMEOUT",
          "Website capture exceeded its maximum duration",
        ),
      ),
    ]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://slow.example");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/that site was not captured/i);
    expect(alert).toHaveTextContent(/exceeded its maximum duration/i);
    expect(alert).toHaveTextContent(/nothing was saved/i);
    expect(alert).toHaveTextContent("CAPTURE_TIMEOUT · 504");
  });

  it("points at the capture install when Chromium is missing", async () => {
    stubApi([
      captureRoute(() =>
        apiError(
          503,
          "CAPTURE_BROWSER_UNAVAILABLE",
          "Chromium could not start; run npm run capture:install and retry",
        ),
      ),
    ]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /npm run capture:install/i,
    );
  });

  it("says a capture is already running rather than failing silently", async () => {
    stubApi([
      captureRoute(() =>
        apiError(
          429,
          "CAPTURE_BUSY",
          "A website capture is already in progress; retry when it completes",
        ),
      ),
    ]);
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only one capture runs at a time/i,
    );
  });

  it("reports the API being down", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderIngest(<WebsiteAccession />);

    await submitAddress("https://example.com");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the archive is not answering/i);
    expect(alert).toHaveTextContent(/127\.0\.0\.1:4611/);
  });
});
