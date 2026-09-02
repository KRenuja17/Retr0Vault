import { describe, expect, it } from "vitest";

import { parseVocabulary } from "./vocabulary";
import {
  formatBytes,
  MAX_UPLOAD_BYTES,
  validateCaptureUrl,
  validateImageFile,
  validateSourceUrl,
} from "./validation";

function file(name: string, type: string, size: number): File {
  const created = new File([new Uint8Array(1)], name, { type });
  Object.defineProperty(created, "size", { value: size });
  return created;
}

describe("image files", () => {
  it("accepts the three formats the backend stores", () => {
    expect(validateImageFile(file("a.jpg", "image/jpeg", 1_024))).toBeNull();
    expect(validateImageFile(file("a.png", "image/png", 1_024))).toBeNull();
    expect(validateImageFile(file("a.webp", "image/webp", 1_024))).toBeNull();
  });

  it("falls back to the extension when the browser reports no type", () => {
    expect(validateImageFile(file("plate.PNG", "", 1_024))).toBeNull();
    expect(validateImageFile(file("plate.gif", "", 1_024))).toMatch(/only jpeg/i);
  });

  it("names the format, the size and an empty file", () => {
    expect(validateImageFile(file("a.gif", "image/gif", 1_024))).toMatch(/only jpeg/i);
    expect(validateImageFile(file("a.png", "image/png", MAX_UPLOAD_BYTES + 1)))
      .toMatch(/accepts up to/i);
    expect(validateImageFile(file("a.png", "image/png", 0))).toMatch(/is empty/i);
  });

  it("accepts a file exactly at the limit", () => {
    expect(validateImageFile(file("a.png", "image/png", MAX_UPLOAD_BYTES))).toBeNull();
  });
});

describe("formatBytes", () => {
  it("reads at the scale a curator thinks in", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2_048)).toBe("2 KB");
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe("25.0 MB");
  });
});

describe("capture addresses", () => {
  it("accepts a plain public https address", () => {
    expect(validateCaptureUrl("https://example.com")).toBeNull();
    expect(validateCaptureUrl("http://example.com/a/b?c=d")).toBeNull();
  });

  it("mirrors the rules the capture route enforces", () => {
    expect(validateCaptureUrl("")).toMatch(/enter the address/i);
    expect(validateCaptureUrl("example.com")).toMatch(/include https/i);
    expect(validateCaptureUrl("ftp://example.com")).toMatch(/only http/i);
    expect(validateCaptureUrl("file:///C:/secrets.txt")).toMatch(/only http/i);
    expect(validateCaptureUrl("https://user:pw@example.com")).toMatch(/credentials/i);
    expect(validateCaptureUrl("https://example.com:8443")).toMatch(/port/i);
    expect(validateCaptureUrl("https://exa mple.com")).toMatch(/spaces/i);
    expect(validateCaptureUrl("https://example.com\\path")).toMatch(/backslashes/i);
  });
});

describe("the optional source address", () => {
  it("allows blank, and refuses anything that is not a plain http(s) link", () => {
    expect(validateSourceUrl("")).toBeNull();
    expect(validateSourceUrl("   ")).toBeNull();
    expect(validateSourceUrl("https://example.com/a")).toBeNull();
    // A port is fine here: the source is metadata and is never fetched.
    expect(validateSourceUrl("https://example.com:8443/a")).toBeNull();
    expect(validateSourceUrl("example.com")).toMatch(/complete https/i);
    expect(validateSourceUrl("javascript:alert(1)")).toMatch(/http/i);
  });
});

describe("vocabulary", () => {
  it("reads one type and term per line, ignoring blank lines", () => {
    expect(parseVocabulary("palette: bone white\n\nimagery: halftone plate")).toEqual({
      tags: [
        { type: "palette", value: "bone white" },
        { type: "imagery", value: "halftone plate" },
      ],
      error: null,
    });
  });

  it("keeps a colon inside the term", () => {
    expect(parseVocabulary("typography: serif display: 44px").tags).toEqual([
      { type: "typography", value: "serif display: 44px" },
    ]);
  });

  it("names the line it cannot read", () => {
    expect(parseVocabulary("palette: bone\nloose term").error).toMatch(/line 2/i);
    expect(parseVocabulary(": bone white").error).toMatch(/line 1/i);
    expect(parseVocabulary("palette:").error).toMatch(/missing a term/i);
  });

  it("refuses a term repeated for the same reference", () => {
    expect(parseVocabulary("palette: Bone White\npalette: bone  white").error)
      .toMatch(/repeats an earlier term/i);
  });

  it("is empty for empty input", () => {
    expect(parseVocabulary("   \n  ")).toEqual({ tags: [], error: null });
  });
});
