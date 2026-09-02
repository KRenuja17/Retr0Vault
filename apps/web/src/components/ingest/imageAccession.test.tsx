import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeDesignType } from "@/components/catalogue/fixtures";
import { MAX_UPLOAD_BYTES } from "@/lib/ingest/validation";

import { ImageAccession } from "./ImageAccession";
import {
  apiError,
  makeFile,
  makeOversizeFile,
  makeStoredReference,
  renderIngest,
  stubApi,
  type StubRequest,
  type StubRoute,
} from "@/test/harness";

const PRINT_TECH = makeDesignType({
  id: "11111111-1111-4111-8111-111111111111",
  slug: "print-tech-paper",
  name: "Print-Tech Paper",
});

const FILED = makeStoredReference({
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  title: "Stillpage",
  analysisStatus: "pending",
});

const IMAGE_UPLOAD = /^\/references\/image$/u;

function uploadRoute(handler: StubRoute["handler"]): StubRoute {
  return { method: "POST", path: IMAGE_UPLOAD, handler };
}

function uploads(requests: readonly StubRequest[]): readonly StubRequest[] {
  return requests.filter(
    (request) => request.method === "POST" && IMAGE_UPLOAD.test(request.pathname),
  );
}

function formValue(request: StubRequest, field: string): string | null {
  const body = request.body;
  if (!(body instanceof FormData)) return null;
  const value = body.get(field);
  return typeof value === "string" ? value : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("filing an image reference", () => {
  it("files the chosen plate and reports it as awaiting analysis", async () => {
    const api = stubApi([
      { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
      uploadRoute(() => FILED),
    ]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("stillpage.png", "image/png"),
    );
    // The mount shows what it is holding before anything is sent.
    expect(await screen.findByText("stillpage.png")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));

    // The outcome exists only once the API has answered with a reference.
    const outcome = await screen.findByRole("status");
    expect(outcome).toHaveTextContent("Stillpage");
    expect(outcome).toHaveTextContent(/awaiting analysis/i);

    const sent = uploads(api.requests);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toBeInstanceOf(FormData);
    expect((sent[0]?.body as FormData).get("file")).toBeInstanceOf(File);
  });

  it("omits an empty title and an empty source rather than sending blanks", async () => {
    const api = stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.webp", "image/webp"),
    );
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));
    await screen.findByRole("status");

    const sent = uploads(api.requests)[0];
    expect(sent).toBeDefined();
    expect(formValue(sent!, "title")).toBeNull();
    expect(formValue(sent!, "sourceUrl")).toBeNull();
    expect(formValue(sent!, "designTypeId")).toBeNull();
  });

  it("sends the optional marginalia when it is given", async () => {
    const api = stubApi([
      { path: /^\/design-types$/u, handler: () => [PRINT_TECH] },
      uploadRoute(() => FILED),
    ]);
    renderIngest(<ImageAccession />);

    // The design-type option only exists after the list request resolves.
    await screen.findByRole("option", { name: "Print-Tech Paper" });

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.png", "image/png"),
    );
    await userEvent.type(screen.getByLabelText(/^title$/i), "Stillpage");
    await userEvent.type(
      screen.getByLabelText(/^source$/i),
      "https://stillpage.example",
    );
    await userEvent.selectOptions(
      screen.getByLabelText(/design type/i),
      PRINT_TECH.id,
    );
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));
    await screen.findByRole("status");

    const sent = uploads(api.requests)[0];
    expect(formValue(sent!, "title")).toBe("Stillpage");
    expect(formValue(sent!, "sourceUrl")).toBe("https://stillpage.example");
    expect(formValue(sent!, "designTypeId")).toBe(PRINT_TECH.id);
  });

  it("mounts a plate dropped onto the specimen area", async () => {
    stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    const mount = screen.getByRole("group", { name: /image plate mount/i });
    fireEvent.dragOver(mount);
    expect(screen.getByText(/release to mount/i)).toBeInTheDocument();

    fireEvent.drop(mount, {
      dataTransfer: { files: [makeFile("dropped.png", "image/png")], types: ["Files"] },
    });

    expect(await screen.findByText("dropped.png")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /file this plate/i }),
    ).toBeEnabled();
  });

  it("takes one plate at a time from a multi-file drop", async () => {
    stubApi();
    renderIngest(<ImageAccession />);

    fireEvent.drop(screen.getByRole("group", { name: /image plate mount/i }), {
      dataTransfer: {
        files: [makeFile("a.png", "image/png"), makeFile("b.png", "image/png")],
        types: ["Files"],
      },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(/one image at a time/i);
    expect(screen.queryByText("a.png")).toBeNull();
  });
});

describe("refusing a file the archive cannot store", () => {
  /*
   * The picker itself is filtered by `accept`, but a drop is not — in any
   * browser, and in user-event, dropping bypasses it entirely. So the format
   * check is exercised through the path that can actually reach it.
   */
  it("names the wrong format on a dropped file and sends nothing", async () => {
    const api = stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    fireEvent.drop(screen.getByRole("group", { name: /image plate mount/i }), {
      dataTransfer: { files: [makeFile("diagram.gif", "image/gif")], types: ["Files"] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /only jpeg, png and webp/i,
    );
    expect(screen.getByRole("button", { name: /file this plate/i })).toBeDisabled();
    expect(uploads(api.requests)).toHaveLength(0);
  });

  it("filters the picker to the formats the archive stores", () => {
    stubApi();
    renderIngest(<ImageAccession />);

    expect(screen.getByLabelText(/choose image file/i)).toHaveAttribute(
      "accept",
      "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp",
    );
  });

  it("names the size limit before spending the round trip", async () => {
    const api = stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeOversizeFile("huge.png", MAX_UPLOAD_BYTES + 1),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/huge\.png is 25\.0 MB/i);
    expect(alert).toHaveTextContent(/accepts up to 25\.0 MB/i);
    expect(uploads(api.requests)).toHaveLength(0);
  });

  it("refuses a malformed source before anything is sent", async () => {
    const api = stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.png", "image/png"),
    );
    await userEvent.type(screen.getByLabelText(/^source$/i), "stillpage.example");
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));

    expect(
      await screen.findByText(/complete https:\/\/ address/i),
    ).toBeInTheDocument();
    expect(uploads(api.requests)).toHaveLength(0);
  });
});

describe("when the upload fails", () => {
  it("reports what the backend refused", async () => {
    stubApi([
      uploadRoute(() =>
        apiError(
          415,
          "UNSUPPORTED_IMAGE_FORMAT",
          "Only JPEG, PNG, and WebP images are accepted",
        ),
      ),
    ]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.png", "image/png"),
    );
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/that plate was not filed/i);
    expect(alert).toHaveTextContent(/only jpeg, png, and webp/i);
    expect(alert).toHaveTextContent("UNSUPPORTED_IMAGE_FORMAT · 415");
  });

  it("reports a stopped API without claiming the plate was stored", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.png", "image/png"),
    );
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/the archive is not answering/i);
    expect(alert).toHaveTextContent(/nothing was stored/i);
    expect(alert).toHaveTextContent(/npm run dev:api/i);
  });

  it("files the plate once when the button is pressed twice", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const api = stubApi([
      uploadRoute(async () => {
        await held;
        return FILED;
      }),
    ]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("plate.png", "image/png"),
    );
    const submit = screen.getByRole("button", { name: /file this plate/i });
    await userEvent.click(submit);

    // The lane is in flight: the control says so and refuses a second press.
    const filing = await screen.findByRole("button", { name: /filing/i });
    expect(filing).toBeDisabled();
    await userEvent.click(filing);

    release();
    await screen.findByRole("status");
    expect(uploads(api.requests)).toHaveLength(1);
  });
});

describe("after a plate is filed", () => {
  it("clears the mount so the next reference starts empty", async () => {
    stubApi([uploadRoute(() => FILED)]);
    renderIngest(<ImageAccession />);

    await userEvent.upload(
      screen.getByLabelText(/choose image file/i),
      makeFile("stillpage.png", "image/png"),
    );
    await userEvent.type(screen.getByLabelText(/^title$/i), "Stillpage");
    await userEvent.click(screen.getByRole("button", { name: /file this plate/i }));
    await screen.findByRole("status");

    await waitFor(() => {
      expect(screen.queryByText("stillpage.png")).toBeNull();
    });
    expect(screen.getByLabelText(/^title$/i)).toHaveValue("");
    expect(screen.getByText(/drop a plate here/i)).toBeInTheDocument();
  });
});
