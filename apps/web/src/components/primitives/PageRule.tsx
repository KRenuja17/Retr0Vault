import type { HTMLAttributes } from "react";

import { cx } from "@/lib/cx";

import styles from "./PageRule.module.css";

export type PageRuleWeight = "hairline" | "regular" | "heavy" | "dotted";
export type PageRuleSpace = "none" | "tight" | "regular" | "loose";

export interface PageRuleProps
  extends Omit<HTMLAttributes<HTMLHRElement>, "children"> {
  readonly weight?: PageRuleWeight;
  readonly space?: PageRuleSpace;
}

const weightClass: Record<PageRuleWeight, string | undefined> = {
  hairline: styles.hairline,
  regular: undefined,
  heavy: styles.heavy,
  dotted: styles.dotted,
};

const spaceClass: Record<PageRuleSpace, string | undefined> = {
  none: styles.spaceNone,
  tight: styles.spaceTight,
  regular: styles.spaceRegular,
  loose: styles.spaceLoose,
};

/**
 * The archive's structural divider. Every horizontal line in Retr0Vault is a
 * PageRule so weight and rhythm stay consistent across views.
 */
export function PageRule({
  weight = "regular",
  space = "none",
  className,
  ...rest
}: PageRuleProps) {
  return (
    <hr
      className={cx(styles.rule, weightClass[weight], spaceClass[space], className)}
      {...rest}
    />
  );
}
