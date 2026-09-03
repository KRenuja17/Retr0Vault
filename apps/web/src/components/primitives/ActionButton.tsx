import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { Link } from "react-router-dom";

import { cx } from "@/lib/cx";

import styles from "./ActionButton.module.css";

export type ActionButtonVariant =
  | "solid"
  | "accent"
  | "outline"
  | "quiet"
  | "remove";
export type ActionButtonSize = "small" | "regular";

interface ActionButtonBaseProps {
  readonly variant?: ActionButtonVariant;
  readonly size?: ActionButtonSize;
  readonly block?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

export interface ActionButtonProps
  extends ActionButtonBaseProps,
    Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "className" | "children" | "type"
    > {
  readonly type?: "button" | "submit" | "reset";
  /**
   * The underlying element, for the rare case where a caller has to move focus
   * onto a button it has just revealed.
   */
  readonly ref?: Ref<HTMLButtonElement> | undefined;
}

export interface ActionLinkProps extends ActionButtonBaseProps {
  readonly to: string;
  readonly title?: string | undefined;
  /** History state carried with the navigation, e.g. the originating slice. */
  readonly state?: unknown;
}

const variantClass: Record<ActionButtonVariant, string | undefined> = {
  solid: styles.solid,
  accent: styles.accent,
  outline: styles.outline,
  quiet: styles.quiet,
  remove: styles.remove,
};

const sizeClass: Record<ActionButtonSize, string | undefined> = {
  small: styles.small,
  regular: styles.regular,
};

function classesFor(
  variant: ActionButtonVariant,
  size: ActionButtonSize,
  block: boolean,
  className: string | undefined,
): string | undefined {
  return cx(
    styles.button,
    variantClass[variant],
    sizeClass[size],
    block && styles.block,
    className,
  );
}

/**
 * The archive's only button. Primary actions are solid ink, the image-recipe
 * action may take the terracotta accent, secondary actions are outlined, and a
 * withdrawal from the archive is outlined in that same accent.
 */
export function ActionButton({
  variant = "solid",
  size = "regular",
  block = false,
  className,
  children,
  type = "button",
  ref,
  ...rest
}: ActionButtonProps) {
  return (
    <button
      type={type}
      ref={ref}
      className={classesFor(variant, size, block, className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** The same visual treatment for in-app navigation. */
export function ActionLink({
  variant = "outline",
  size = "regular",
  block = false,
  className,
  children,
  to,
  title,
  state,
}: ActionLinkProps) {
  return (
    <Link
      to={to}
      title={title}
      state={state}
      className={classesFor(variant, size, block, className)}
    >
      {children}
    </Link>
  );
}
