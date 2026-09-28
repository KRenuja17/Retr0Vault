import { createContext, useContext } from "react";

import { filterToPath, originFromState, type CatalogueFilter } from "@/lib/catalogue/filters";

/*
 * A reference has two sheets: its design analysis (`/reference/:id`) and its
 * motion study (`/motion/:id`), each linking to the other. Moving between them
 * is one sheet turning into the other, not a new one opened on top: the link
 * replaces the history entry instead of adding one, and carries along what the
 * sheets were opened over. So however often the reader switches, CLOSE (or
 * Back) returns straight to that page, and the page behind the sheet never
 * changes while they do.
 */

/** The page a sheet is raised over. */
export type SheetBackdrop =
  | { readonly kind: "catalogue"; readonly filter: CatalogueFilter }
  | { readonly kind: "motion"; readonly path: string };

export interface SheetStack {
  readonly backdrop: SheetBackdrop;
  /**
   * Whether the backdrop is the history entry just before the sheet, so
   * closing can step back to it (restoring its scroll position). A sheet
   * visited directly by its address has nothing behind it and replaces itself
   * with the backdrop instead.
   */
  readonly inHistory: boolean;
}

/** The stack a sibling sheet handed over in the location state, if any. */
export function sheetStackFromState(state: unknown): SheetStack | undefined {
  if (typeof state !== "object" || state === null || !("sheet" in state)) return undefined;
  const sheet = (state as { sheet: unknown }).sheet;
  if (typeof sheet !== "object" || sheet === null) return undefined;
  const { backdrop, inHistory } = sheet as { backdrop?: unknown; inHistory?: unknown };
  if (typeof inHistory !== "boolean" || typeof backdrop !== "object" || backdrop === null) return undefined;
  const candidate = backdrop as { kind?: unknown; path?: unknown; filter?: unknown };
  if (candidate.kind === "motion" && typeof candidate.path === "string" && candidate.path.startsWith("/motion")) {
    return { backdrop: { kind: "motion", path: candidate.path }, inHistory };
  }
  if (candidate.kind === "catalogue") {
    // Validated the same way a plate's own `origin` is.
    return { backdrop: { kind: "catalogue", filter: originFromState({ origin: candidate.filter }) }, inHistory };
  }
  return undefined;
}

export function backdropPath(backdrop: SheetBackdrop): string {
  return backdrop.kind === "catalogue" ? filterToPath(backdrop.filter) : backdrop.path;
}

const SheetStackContext = createContext<SheetStack | undefined>(undefined);

/** Provided by each sheet route, for the links inside the sheet. */
export const SheetStackProvider = SheetStackContext.Provider;

/**
 * Props for a link from the open sheet to its sibling sheet: it replaces the
 * current entry and hands the stack on. Outside a sheet it is an ordinary link.
 */
export function useSiblingSheetLink(): { readonly replace?: true; readonly state?: { readonly sheet: SheetStack } } {
  const stack = useContext(SheetStackContext);
  return stack === undefined ? {} : { replace: true, state: { sheet: stack } };
}
