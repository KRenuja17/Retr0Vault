import { describe, expect, it } from "vitest";

import {
  comparePath,
  directionPath,
  MAX_SELECTION,
  MIN_MULTI_SELECTION,
  parseRefs,
  REFS_PARAM,
  serialiseRefs,
  toggleId,
} from "./selection";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

describe("reading a selection out of the address", () => {
  it("keeps the order the ids were written in", () => {
    expect(parseRefs(`${C},${A},${B}`)).toEqual([C, A, B]);
  });

  it("treats a missing or empty parameter as no selection", () => {
    expect(parseRefs(null)).toEqual([]);
    expect(parseRefs(undefined)).toEqual([]);
    expect(parseRefs("")).toEqual([]);
    expect(parseRefs(",,")).toEqual([]);
  });

  it("drops anything that is not a UUID rather than sending it to the backend", () => {
    expect(parseRefs(`${A},not-a-uuid,../../etc,${B}`)).toEqual([A, B]);
    expect(parseRefs("<script>alert(1)</script>")).toEqual([]);
  });

  it("normalises case and collapses a repeated id to its first place", () => {
    expect(parseRefs(`${A.toUpperCase()},${B},${A}`)).toEqual([A, B]);
  });

  it("tolerates whitespace around each id", () => {
    expect(parseRefs(` ${A} , ${B} `)).toEqual([A, B]);
  });

  it("never reads more ids than the backend will accept", () => {
    const many = Array.from(
      { length: MAX_SELECTION + 20 },
      (_, index) =>
        `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(parseRefs(many.join(",")).length).toBe(MAX_SELECTION);
  });
});

describe("writing a selection into the address", () => {
  it("round-trips through the refs parameter", () => {
    const path = comparePath([A, B]);
    const params = new URLSearchParams(path.slice(path.indexOf("?")));
    expect(parseRefs(params.get(REFS_PARAM))).toEqual([A, B]);
  });

  it("addresses both sheets with the same selection", () => {
    expect(comparePath([A, B])).toBe(`/compare?${REFS_PARAM}=${A}%2C${B}`);
    expect(directionPath([A, B])).toBe(`/direction?${REFS_PARAM}=${A}%2C${B}`);
  });

  it("serialises to a plain comma list", () => {
    expect(serialiseRefs([A, B])).toBe(`${A},${B}`);
  });
});

describe("marking and unmarking", () => {
  it("adds a plate at the end so the first marked stays primary", () => {
    expect(toggleId([A], B)).toEqual([A, B]);
    expect(toggleId([A, B], C)).toEqual([A, B, C]);
  });

  it("removes a plate in place, leaving the rest in order", () => {
    expect(toggleId([A, B, C], B)).toEqual([A, C]);
  });

  it("removing the primary promotes the next one", () => {
    expect(toggleId([A, B, C], A)).toEqual([B, C]);
  });

  it("refuses to mark past the backend's limit", () => {
    const full = Array.from(
      { length: MAX_SELECTION },
      (_, index) =>
        `aaaaaaaa-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(toggleId(full, C)).toBe(full);
    expect(toggleId(full, full[0] as string)).toHaveLength(MAX_SELECTION - 1);
  });
});

describe("the multi-reference minimum", () => {
  it("matches the backend's own pending-combination minimum", () => {
    expect(MIN_MULTI_SELECTION).toBe(2);
  });
});
