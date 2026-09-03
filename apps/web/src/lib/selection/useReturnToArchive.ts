import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { filterToPath, type CatalogueFilter } from "@/lib/catalogue/filters";

export interface ReturnToArchive {
  /** Where the sheet was opened from, as an address. */
  readonly path: string;
  readonly close: () => void;
}

/**
 * Closing a multi-reference sheet.
 *
 * When the sheet was opened from the catalogue, going back is what returns the
 * reader to the exact view they left — route, filter, search and scroll — so
 * Back and CLOSE stay the same act. A sheet reached by a pasted link has no
 * catalogue behind it in history, so it navigates to the recorded origin
 * instead, replacing itself rather than growing the stack.
 */
export function useReturnToArchive(origin: CatalogueFilter): ReturnToArchive {
  const location = useLocation();
  const navigate = useNavigate();
  const path = filterToPath(origin);
  const openedFromCatalogue = location.key !== "default";

  const close = useCallback(() => {
    if (openedFromCatalogue) {
      navigate(-1);
    } else {
      navigate(path, { replace: true });
    }
  }, [navigate, openedFromCatalogue, path]);

  return { path, close };
}
