import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import { cx } from "@/lib/cx";

import styles from "./FilterTab.module.css";

export interface FilterTabProps {
  readonly label: ReactNode;
  /** Live reference count printed beside the label. */
  readonly count?: number;
  /** Route target; when omitted the tab renders as a button. */
  readonly to?: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  /** Pinned collections carry a ◈ before the label. */
  readonly marker?: boolean;
  readonly onSelect?: () => void;
  readonly className?: string | undefined;
  readonly title?: string | undefined;
  /**
   * Whether the router's own path match also marks the tab active. Off for
   * tabs that differ only by query string (the Motion rail's `?trigger=`),
   * which a path match cannot tell apart; `active` then decides alone.
   */
  readonly matchRoute?: boolean;
}

/**
 * The rectangular catalogue filter. Square corners, one hairline black rule,
 * mono uppercase label, accent counter; the active tab inverts to solid ink.
 */
export function FilterTab({
  label,
  count,
  to,
  active = false,
  disabled = false,
  marker = false,
  onSelect,
  className,
  title,
  matchRoute = true,
}: FilterTabProps) {
  const content = (
    <>
      {marker ? (
        <span className={styles.marker} aria-hidden="true">
          ◈
        </span>
      ) : null}
      <span className={styles.label}>{label}</span>
      {typeof count === "number" ? (
        <span className={styles.count}>{count}</span>
      ) : null}
    </>
  );

  if (to !== undefined && !disabled) {
    return (
      <NavLink
        to={to}
        end
        title={title}
        onClick={onSelect}
        className={({ isActive }) =>
          cx(styles.tab, (active || (matchRoute && isActive)) && styles.active, className) ?? ""
        }
      >
        {content}
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      aria-pressed={active}
      onClick={onSelect}
      className={cx(styles.tab, active && styles.active, className)}
    >
      {content}
    </button>
  );
}
