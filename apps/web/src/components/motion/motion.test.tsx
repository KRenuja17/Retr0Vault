import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { makeReference } from "@/components/catalogue/fixtures";
import { PlaybackCoordinator } from "@/lib/motion/playback";
import { referencePage, renderRoute, stubApi } from "@/test/harness";

import { HERO_CLIP, makeClip, makeListItem, makeStudy, motionPage, REFERENCE_ID, SCROLL_CLIP } from "./fixtures";
import { validateRecordingFile } from "./MotionAccession";

let play: ReturnType<typeof vi.fn>;
let pause: ReturnType<typeof vi.fn>;

function reducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}

beforeEach(() => {
  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(pause);
  reducedMotion(false);
  try {
    window.localStorage.clear();
  } catch {
    // Storage unavailable; preferences fall back to defaults.
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("playback coordinator", () => {
  it("never lets more than two plates play, pausing the oldest", () => {
    const coordinator = new PlaybackCoordinator(2);
    const players = [0, 1, 2].map(() => ({ pause: vi.fn() }));
    players.forEach((player) => coordinator.start(player));
    expect(players[0]!.pause).toHaveBeenCalledOnce();
    expect(players[1]!.pause).not.toHaveBeenCalled();
    expect(coordinator.playing).toEqual([players[1], players[2]]);
    coordinator.start(players[1]!);
    expect(coordinator.playing).toEqual([players[2], players[1]]);
    coordinator.stop(players[2]!);
    expect(coordinator.playing).toEqual([players[1]]);
  });
});

describe("the Motion section", () => {
  it("lists studies as moving plates, with the rail following the trigger in the address", async () => {
    const api = stubApi([
      { path: /^\/motion$/u, handler: ({ search }) => search.get("limit") === "1"
        ? motionPage([makeListItem()], { cursor: 1, scroll: 1 })
        : motionPage(search.get("trigger") === "wheel" ? [] : [makeListItem()], { cursor: 1, scroll: 1 }) },
    ]);
    const { router } = renderRoute("/motion?trigger=cursor");

    const plate = await screen.findByRole("article");
    expect(within(plate).getByRole("link", { name: "Lando Norris" })).toHaveAttribute("href", `/motion/${REFERENCE_ID}`);
    expect(within(plate).getByText("cursor-painted livery × block-wipe scroll")).toBeInTheDocument();
    expect(within(plate).getByText("Scroll · Cursor")).toBeInTheDocument();
    expect(within(plate).getByText("00:00 / 00:15")).toBeInTheDocument();
    expect(plate.querySelector("video")).toHaveAttribute("src", `/api/v1/media/motion/${HERO_CLIP}/preview`);

    const rail = screen.getByRole("navigation", { name: "Motion filters" });
    expect(within(rail).getByRole("link", { name: /Cursor/ }).className).toMatch(/active/u);
    expect(within(rail).getByRole("link", { name: /All motion/ }).className).not.toMatch(/active/u);
    expect(api.requests.some((request) => request.search.get("trigger") === "cursor")).toBe(true);

    await userEvent.type(screen.getByRole("searchbox"), "wipe");
    await userEvent.click(screen.getByRole("button", { name: "Find" }));
    await waitFor(() => expect(router.state.location.search).toBe("?trigger=cursor&q=wipe"));

    await userEvent.click(within(rail).getByRole("link", { name: /Wheel/ }));
    expect(await screen.findByText("No motion study matches that")).toBeInTheDocument();
  });

  it("explains the section when nothing has been recorded", async () => {
    stubApi([{ path: /^\/motion$/u, handler: () => motionPage([]) }]);
    renderRoute("/motion");
    expect(await screen.findByText("No recordings in the archive yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a recording" })).toHaveAttribute("href", "/add#motion");
  });

  it("plays on hover and pauses on leave", async () => {
    stubApi([{ path: /^\/motion$/u, handler: () => motionPage([makeListItem()]) }]);
    renderRoute("/motion");
    const plate = await screen.findByRole("article");
    fireEvent.pointerEnter(plate);
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent.pointerLeave(plate);
    await waitFor(() => expect(pause).toHaveBeenCalled());
  });

  it("never plays by itself under reduced motion, only on an explicit PLAY", async () => {
    reducedMotion(true);
    stubApi([{ path: /^\/motion$/u, handler: () => motionPage([makeListItem()]) }]);
    renderRoute("/motion");
    const plate = await screen.findByRole("article");
    fireEvent.pointerEnter(plate);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(play).not.toHaveBeenCalled();
    await userEvent.click(within(plate).getByRole("button", { name: "Play Lando Norris" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("shows a processing plate until the clip is ready", async () => {
    stubApi([{ path: /^\/motion$/u, handler: () => motionPage([makeListItem({
      motionStatus: "pending",
      primaryClip: { id: HERO_CLIP, label: "Primary", processingStatus: "processing", durationMs: null, width: null, height: null, keyframeCount: 0 },
    })]) }]);
    renderRoute("/motion");
    const plate = await screen.findByRole("article");
    expect(within(plate).getByText("Processing")).toBeInTheDocument();
    expect(within(plate).getByText("Awaiting analysis")).toBeInTheDocument();
    expect(plate.querySelector("video")).toBeNull();
  });
});

describe("catalogue cross-links", () => {
  it("marks references with a motion study and links their sheet to it", async () => {
    const withMotion = makeReference({
      id: REFERENCE_ID, title: "Lando Norris", catalogueIndex: 1,
      motion: { studyId: "dddddddd-0000-4000-8000-000000000001", status: "analyzed", clipCount: 2, readyClipCount: 2, primaryClipId: HERO_CLIP, durationMs: 15_000, previewClipId: HERO_CLIP },
    });
    const without = makeReference({ id: "aaaaaaaa-0000-4000-8000-000000000009", title: "Still only", catalogueIndex: 2 });
    stubApi([
      { path: /^\/references$/u, handler: () => referencePage([withMotion, without]) },
      { path: new RegExp(`^/references/${REFERENCE_ID}$`, "u"), handler: () => withMotion },
    ]);
    renderRoute("/all");
    const plates = await screen.findAllByRole("article");
    expect(within(plates[0]!).getByText("◉ Motion")).toBeInTheDocument();
    expect(within(plates[1]!).queryByText("◉ Motion")).toBeNull();

    await userEvent.click(within(plates[0]!).getByRole("link", { name: "Lando Norris" }));
    expect(await screen.findByRole("link", { name: "Motion study →" })).toHaveAttribute("href", `/motion/${REFERENCE_ID}`);
  });
});

describe("the motion sheet", () => {
  function sheetRoutes(study = makeStudy()) {
    return stubApi([
      { path: /^\/motion$/u, handler: () => motionPage([makeListItem()]) },
      { path: new RegExp(`^/references/${REFERENCE_ID}/motion$`, "u"), handler: () => study },
      { path: /^\/motion\/clips\/[^/]+\/energy$/u, handler: () => ({ sampleFps: 10, energy: [0, 0.1, 0.3, 0.1, 0] }) },
      { method: "PATCH", path: new RegExp(`^/references/${REFERENCE_ID}/motion$`, "u"), handler: ({ body }) => ({ ...study, ...(body as object) }) },
    ]);
  }

  it("opens on the linked clip and moment, and seeks from beats", async () => {
    sheetRoutes();
    const { router } = renderRoute(`/motion/${REFERENCE_ID}?clip=${SCROLL_CLIP}&t=4000`, ["/motion"]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("heading", { name: "Lando Norris" })).toBeInTheDocument();
    expect(within(dialog).getByRole("tab", { name: "Scroll journey" })).toHaveAttribute("aria-selected", "true");

    const video = dialog.querySelector("video")!;
    expect(video).toHaveAttribute("src", `/api/v1/media/motion/${SCROLL_CLIP}/clip`);
    // The deep link waits for the metadata before seeking.
    Object.defineProperty(video, "readyState", { configurable: true, value: 1 });
    fireEvent(video, new Event("loadedmetadata"));
    expect(video.currentTime).toBe(4);

    await userEvent.click(within(dialog).getByRole("button", { name: /Livery sweep/ }));
    expect(within(dialog).getByRole("tab", { name: "Hero cursor" })).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(router.state.location.search).toContain(`clip=${HERO_CLIP}`));

    const strip = within(dialog).getByRole("slider");
    strip.focus();
    await userEvent.keyboard("{End}");
    expect(strip).toHaveAttribute("aria-valuetext", "00:15.00");
  });

  it("separates verified from inferred technology, citing the source", async () => {
    sheetRoutes();
    renderRoute(`/motion/${REFERENCE_ID}`);
    const dialog = await screen.findByRole("dialog");
    const implementation = await within(dialog).findByRole("region", { name: "Implementation" });
    expect(within(implementation).getByText("Verified")).toBeInTheDocument();
    expect(within(implementation).getByText("— html.lenis class present (DevTools)")).toBeInTheDocument();
    expect(within(implementation).getByText("Inferred")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "View design analysis" })).toHaveAttribute("href", `/reference/${REFERENCE_ID}`);
  });

  it("saves inspection notes and verified tech, refusing half-filled entries", async () => {
    const api = sheetRoutes();
    renderRoute(`/motion/${REFERENCE_ID}`);
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Add verified tech" }));
    const save = within(dialog).getByRole("button", { name: "Save notes" });
    expect(save).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Verified claim 1" }), "Page requests a WebGL2 context");
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Source of claim 1" }), "canvas instrumentation");
    await userEvent.click(save);
    await waitFor(() => expect(api.requests.some((request) => request.method === "PATCH")).toBe(true));
    const patch = api.requests.find((request) => request.method === "PATCH")!.body as { verifiedTech: unknown[] };
    expect(patch.verifiedTech).toEqual([
      { claim: "html.lenis class present", source: "DevTools" },
      { claim: "Page requests a WebGL2 context", source: "canvas instrumentation" },
    ]);
  });

  it("explains a study whose recordings are still processing", async () => {
    sheetRoutes(makeStudy({ motionStatus: "pending", motionDNA: null, beats: [], implementation: [], analysis: null,
      clips: [makeClip({ id: HERO_CLIP, label: "Primary", processingStatus: "processing", evidence: null, keyframes: [], durationMs: null })] }));
    renderRoute(`/motion/${REFERENCE_ID}`);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Awaiting motion analysis")).toBeInTheDocument();
    expect(within(dialog).getByText(/The recordings are being processed/u)).toBeInTheDocument();
    expect(dialog.querySelector("video")).toBeNull();
  });
});

describe("the motion recording lane", () => {
  it("accepts video files within the limits only", () => {
    expect(validateRecordingFile(new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" }))).toBeNull();
    expect(validateRecordingFile(new File([new Uint8Array(10)], "clip.mkv", { type: "" }))).toBeNull();
    expect(validateRecordingFile(new File([new Uint8Array(10)], "notes.txt", { type: "text/plain" }))).toMatch(/screen recording/u);
    expect(validateRecordingFile(new File([], "empty.mp4", { type: "video/mp4" }))).toMatch(/empty/u);
    const huge = new File([new Uint8Array(1)], "huge.mp4", { type: "video/mp4" });
    Object.defineProperty(huge, "size", { value: 400 * 1_024 * 1_024 });
    expect(validateRecordingFile(huge)).toMatch(/limited/u);
  });

  it("files a recording for the chosen reference and follows it to ready", async () => {
    const reference = makeReference({ id: REFERENCE_ID, title: "Lando Norris" });
    let reads = 0;
    const queued = makeStudy({ motionStatus: "pending", clips: [makeClip({ id: HERO_CLIP, label: "Hero cursor", processingStatus: "queued", evidence: null, keyframes: [] })] });
    const api = stubApi([
      { path: new RegExp(`^/references/${REFERENCE_ID}$`, "u"), handler: () => reference },
      { method: "POST", path: new RegExp(`^/references/${REFERENCE_ID}/motion/clips$`, "u"), handler: () => new Response(JSON.stringify(queued), { status: 202, headers: { "Content-Type": "application/json" } }) },
      { path: new RegExp(`^/references/${REFERENCE_ID}/motion$`, "u"), handler: () => (reads++ === 0 ? queued : makeStudy({ motionStatus: "pending" })) },
    ]);
    renderRoute(`/add?reference=${REFERENCE_ID}`);
    expect(await screen.findByText("Recording for")).toBeInTheDocument();

    const input = document.querySelector<HTMLInputElement>("#motion input[type=file]")!;
    await userEvent.upload(input, new File([new Uint8Array(64)], "hero.mp4", { type: "video/mp4" }));
    await userEvent.type(screen.getByRole("textbox", { name: /^Label/ }), "Hero cursor");
    await userEvent.click(screen.getByRole("button", { name: "File this recording" }));

    await waitFor(() => expect(api.requests.some((request) => request.method === "POST")).toBe(true));
    const form = api.requests.find((request) => request.method === "POST")!.body as FormData;
    expect(form.get("label")).toBe("Hero cursor");
    expect(form.get("posterMs")).toBe("1000");
    expect((form.get("file") as File).name).toBe("hero.mp4");
    expect(await screen.findByText(/Ready · awaiting motion analysis/iu, {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the motion sheet" })).toHaveAttribute("href", `/motion/${REFERENCE_ID}`);
  });
});

describe("the comparison sheet", () => {
  it("adds a motion study row in words, without playing anything", async () => {
    const studied = makeReference({
      id: REFERENCE_ID, title: "Lando Norris",
      motion: { studyId: "dddddddd-0000-4000-8000-000000000001", status: "analyzed", clipCount: 2, readyClipCount: 2, primaryClipId: HERO_CLIP, durationMs: 15_000, previewClipId: HERO_CLIP },
    });
    const still = makeReference({ id: "aaaaaaaa-0000-4000-8000-000000000009", title: "Still only" });
    stubApi([
      { path: new RegExp(`^/references/${REFERENCE_ID}$`, "u"), handler: () => studied },
      { path: /^\/references\/aaaaaaaa-0000-4000-8000-000000000009$/u, handler: () => still },
      { path: new RegExp(`^/references/${REFERENCE_ID}/motion$`, "u"), handler: () => makeStudy() },
    ]);
    renderRoute(`/compare?refs=${REFERENCE_ID},${still.id}`);
    const row = (await screen.findByRole("rowheader", { name: "Motion study" })).closest("tr")!;
    expect(await within(row).findByText("cursor-painted livery × block-wipe scroll")).toBeInTheDocument();
    expect(within(row).getByText("Cursor · Scroll")).toBeInTheDocument();
    expect(within(row).getByRole("link", { name: "2 recordings · open motion study" })).toHaveAttribute("href", `/motion/${REFERENCE_ID}`);
    expect(within(row).getByText("Not recorded")).toBeInTheDocument();
    expect(document.querySelector("video")).toBeNull();
  });
});

describe("catalogue plates with motion", () => {
  const withClip = makeReference({
    id: REFERENCE_ID, title: "Lando Norris", catalogueIndex: 1,
    motion: { studyId: "dddddddd-0000-4000-8000-000000000001", status: "analyzed", clipCount: 2, readyClipCount: 2, primaryClipId: HERO_CLIP, durationMs: 15_000, previewClipId: SCROLL_CLIP },
  });
  const processing = makeReference({
    id: "aaaaaaaa-0000-4000-8000-000000000010", title: "Still processing", catalogueIndex: 2,
    motion: { studyId: "dddddddd-0000-4000-8000-000000000002", status: "pending", clipCount: 1, readyClipCount: 0, primaryClipId: HERO_CLIP, durationMs: null, previewClipId: null },
  });
  const still = makeReference({ id: "aaaaaaaa-0000-4000-8000-000000000009", title: "Still only", catalogueIndex: 3 });

  function catalogue() {
    stubApi([{ path: /^\/references$/u, handler: () => referencePage([withClip, processing, still]) }]);
    renderRoute("/all");
  }

  it("loops the ready clip over the screenshot, and keeps the screenshot everywhere else", async () => {
    catalogue();
    const [lando, waiting, plain] = await screen.findAllByRole("article");
    const video = lando!.querySelector("video")!;
    expect(video).toHaveAttribute("src", `/api/v1/media/motion/${SCROLL_CLIP}/preview`);
    expect(video.loop).toBe(true);
    expect(video.muted).toBe(true);
    await waitFor(() => expect(play).toHaveBeenCalled());
    // The screenshot stays underneath until the clip is really playing.
    expect(lando!.querySelector("img")).toHaveAttribute("src", `/api/v1/media/${REFERENCE_ID}/thumbnail?v=${encodeURIComponent(withClip.updatedAt)}`);
    expect(video.className).not.toMatch(/clipPlaying/u);
    fireEvent(video, new Event("playing"));
    expect(video.className).toMatch(/clipPlaying/u);

    for (const card of [waiting!, plain!]) {
      expect(card.querySelector("video")).toBeNull();
      expect(card.querySelector("img")).not.toBeNull();
    }
  });

  it("falls back to the screenshot when the clip cannot play", async () => {
    catalogue();
    const [lando] = await screen.findAllByRole("article");
    fireEvent(lando!.querySelector("video")!, new Event("error"));
    expect(lando!.querySelector("video")).toBeNull();
    expect(lando!.querySelector("img")).not.toBeNull();
  });

  it("shows only the screenshot under reduced motion", async () => {
    reducedMotion(true);
    catalogue();
    const [lando] = await screen.findAllByRole("article");
    expect(lando!.querySelector("video")).toBeNull();
    expect(play).not.toHaveBeenCalled();
  });
});

