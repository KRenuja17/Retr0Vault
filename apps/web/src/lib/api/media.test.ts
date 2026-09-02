import { describe, expect, it } from "vitest";

import { referenceOriginalUrl, referenceThumbnailUrl } from "./media";

const ID = "3f2a1c7e-8b90-4d21-9f55-0a1b2c3d4e5f";

describe("reference media URLs", () => {
  it("addresses media by reference id, not by storage path", () => {
    expect(referenceThumbnailUrl(ID)).toBe(`/api/v1/media/${ID}/thumbnail`);
    expect(referenceOriginalUrl(ID)).toBe(`/api/v1/media/${ID}/original`);
  });

  it("stays same-origin so the dev proxy carries the request", () => {
    expect(referenceThumbnailUrl(ID).startsWith("/api/v1/")).toBe(true);
    expect(referenceThumbnailUrl(ID)).not.toMatch(/^https?:/u);
  });

  it("escapes anything that is not a plain id", () => {
    expect(referenceThumbnailUrl("../../storage/originals")).toBe(
      "/api/v1/media/..%2F..%2Fstorage%2Foriginals/thumbnail",
    );
  });
});
