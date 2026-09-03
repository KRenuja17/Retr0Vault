import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { MAX_SELECTION, toggleId } from "./selection";

/**
 * The working selection, held for the whole shell rather than per route.
 *
 * It lives above the router outlet on purpose: marking plates, opening a
 * reference sheet at /reference/:id and coming back is one continuous act, and
 * the marks have to survive that round trip. It is view state only — nothing
 * here writes to a reference.
 */
export interface SelectionState {
  /** Whether the catalogue is currently marking plates. */
  readonly active: boolean;
  /** Marked references, in the order they were marked; the first is primary. */
  readonly ids: readonly string[];
  readonly count: number;
  /** The backend caps one selection at 100 references. */
  readonly full: boolean;
  readonly isSelected: (id: string) => boolean;
  readonly toggle: (id: string) => void;
  readonly enter: () => void;
  /** Leaves selection mode and drops the marks: no invisible state. */
  readonly exit: () => void;
  /** Empties the marks but stays in selection mode. */
  readonly clear: () => void;
}

const SelectionContext = createContext<SelectionState | null>(null);

export function SelectionProvider({ children }: { readonly children: ReactNode }) {
  const [active, setActive] = useState(false);
  const [ids, setIds] = useState<readonly string[]>([]);

  const toggle = useCallback((id: string) => {
    setIds((current) => toggleId(current, id));
  }, []);

  const enter = useCallback(() => setActive(true), []);

  const exit = useCallback(() => {
    setActive(false);
    setIds([]);
  }, []);

  const clear = useCallback(() => setIds([]), []);

  const value = useMemo<SelectionState>(
    () => ({
      active,
      ids,
      count: ids.length,
      full: ids.length >= MAX_SELECTION,
      isSelected: (id: string) => ids.includes(id),
      toggle,
      enter,
      exit,
      clear,
    }),
    [active, ids, toggle, enter, exit, clear],
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

/**
 * The selection, or null where no provider is mounted. Returning null rather
 * than throwing keeps the catalogue renderable on its own — a view rendered
 * outside the shell simply has no marking UI.
 */
export function useSelection(): SelectionState | null {
  return useContext(SelectionContext);
}
