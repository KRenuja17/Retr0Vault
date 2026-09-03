import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/*
 * The physical-lift language, asserted against the stylesheets themselves.
 *
 * jsdom compiles no CSS — the suite runs with `css: false` — so nothing here
 * measures a rendered pixel. What it does guard is the set of conditions the
 * interaction pass is built on and which are easy to lose in a later edit: the
 * lift is fine-pointer only, reduced motion gives up the displacement, every
 * shadow is unblurred, and the modal animates in but never out.
 */

/*
 * Read off disk, never imported: a CSS-module import would hand back Vite's
 * class-name proxy, and asking Vite for the source with `?url` is refused for
 * modules outright. `join` keeps the path out of Vite's static analysis.
 */
const here = dirname(fileURLToPath(import.meta.url));

function stylesheet(...segments: readonly string[]): string {
  return readFileSync(join(here, ...segments), "utf8");
}

const plate = stylesheet("CatalogueCard.module.css");
const modal = stylesheet("ModalSurface.module.css");
const button = stylesheet("ActionButton.module.css");
const tokens = stylesheet("..", "..", "styles", "tokens.css");

/** The body of the first at-rule whose prelude matches, braces balanced. */
function atRule(css: string, prelude: string): string {
  const start = css.indexOf(`@media ${prelude}`);
  expect(start, `no @media ${prelude} in the stylesheet`).toBeGreaterThan(-1);

  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, index);
    }
  }
  throw new Error(`unbalanced @media ${prelude}`);
}

describe("depth tokens", () => {
  it("draws every shadow hard: ink, offset, no blur and no spread", () => {
    const shadows = [...tokens.matchAll(/--rv-shadow-[\w-]+:\s*([^;]+);/gu)].map(
      (match) => match[1]?.trim() ?? "",
    );

    expect(shadows.length).toBeGreaterThanOrEqual(3);
    for (const shadow of shadows) {
      // `<x> <y> 0 <colour>` — a third length of 0 is the whole point.
      expect(shadow, `${shadow} carries a blur radius`).toMatch(
        /^\d+px \d+px 0 rgba\(var\(--rv-grid-ink\), [\d.]+\)$/u,
      );
    }
  });

  it("lifts the plate 3px and drops its shadow 6px", () => {
    expect(tokens).toMatch(/--rv-lift:\s*3px;/u);
    expect(tokens).toMatch(/--rv-shadow-plate:\s*6px 6px 0/u);
    expect(tokens).toMatch(/--rv-shadow-sheet:\s*12px 12px 0/u);
  });
});

describe("catalogue plate lift", () => {
  const fine = atRule(plate, "(hover: hover) and (pointer: fine)");
  const reduced = atRule(plate, "(prefers-reduced-motion: reduce)");

  it("moves the plate only under a fine pointer", () => {
    expect(fine).toContain(".interactive:hover");
    expect(fine).toContain("var(--rv-shadow-plate)");

    // No `:hover` transform may exist outside that guard.
    const unguarded = plate.replace(fine, "").replace(reduced, "");
    expect(unguarded).not.toMatch(/:hover[^{]*\{[^}]*transform:/su);
  });

  it("gives up the displacement under reduced motion", () => {
    expect(reduced).toMatch(/transform:\s*translate\(0,\s*0\)/u);
    expect(reduced).toContain(".interactive:hover");
    expect(reduced).toContain(".interactive:has(:focus-visible)");
  });

  it("harmonises keyboard focus with the same lift, on any pointer", () => {
    const focus = plate.slice(plate.indexOf(".interactive:has(:focus-visible)"));
    expect(focus).toContain("var(--rv-shadow-plate)");
    // Outside the fine-pointer rule, so Tab lifts a plate on a tablet too.
    expect(fine).not.toContain(":has(:focus-visible)");
  });

  it("never scales the plate or zooms its capture", () => {
    expect(plate).not.toMatch(/scale\(/u);
    expect(plate).not.toMatch(/blur\(/u);
  });
});

describe("modal sheet", () => {
  it("sits over the catalogue on a hard offset shadow", () => {
    expect(modal).toContain("box-shadow: var(--rv-shadow-sheet)");
  });

  it("is placed onto the archive, and never flown out again", () => {
    expect(modal).toMatch(/animation: rv-scrim-in var\(--rv-motion-base\)/u);
    expect(modal).toMatch(/animation: rv-sheet-in var\(--rv-motion-sheet\)/u);
    expect(modal).toMatch(/transform: translateY\(6px\)/u);

    /*
     * An exit animation would hold the dialog mounted while Radix waits on it,
     * which is exactly the window in which focus restoration goes fragile.
     */
    expect(modal).not.toContain('data-state="closed"');
    expect(modal).not.toMatch(/@keyframes [\w-]+-out/u);
  });

  it("drops the shadow where the sheet goes full-bleed", () => {
    expect(atRule(modal, "(max-width: 759px)")).toContain("box-shadow: none");
  });
});

describe("action buttons", () => {
  it("swaps ink for terracotta and back, introducing no third colour", () => {
    expect(button).toMatch(
      /\.solid:hover \{[^}]*background-color: var\(--rv-accent\)/su,
    );
    expect(button).toMatch(
      /\.accent:hover \{[^}]*background-color: var\(--rv-surface-inverse\)/su,
    );
    expect(button).toMatch(
      /\.outline:hover \{[^}]*background-color: var\(--rv-surface-inverse\)[^}]*color: var\(--rv-ink-inverse\)/su,
    );

    // Every colour in the file is a token; the old literal is gone.
    expect(button).not.toMatch(/#[0-9a-f]{3,8}/iu);
  });

  it("presses one pixel down and right, and not under reduced motion", () => {
    expect(button).toMatch(
      /\.button:active \{[^}]*translate\(var\(--rv-lift-pressed\), var\(--rv-lift-pressed\)\)/su,
    );
    expect(atRule(button, "(prefers-reduced-motion: reduce)")).toMatch(
      /transform: none/u,
    );
  });
});
