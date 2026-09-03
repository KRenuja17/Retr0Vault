import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { cx } from "@/lib/cx";

import styles from "./ModalSurface.module.css";

export type ModalSurfaceSize = "regular" | "wide" | "specimen";

/**
 * Where the dialog's accessible name comes from. "hidden" renders `label` for
 * screen readers only, which suits a surface whose content has no title of its
 * own. "provided" means the caller renders <ModalTitle> as part of its visible
 * content — use it whenever there IS a visible title, so the name is not
 * announced twice by two headings carrying the same text.
 */
export type ModalTitleMode = "hidden" | "provided";

export interface ModalSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Accessible name for the dialog; the visible title lives in `children`. */
  readonly label: string;
  /** The reference image or frame strip that leads the modal. */
  readonly media?: ReactNode;
  /** Action row pinned below the scrolling sheet. */
  readonly footer?: ReactNode;
  readonly size?: ModalSurfaceSize;
  readonly titleMode?: ModalTitleMode;
  /** Set false to drop the corner close affordance (footer close only). */
  readonly showCloseButton?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

const sizeClass: Record<ModalSurfaceSize, string | undefined> = {
  regular: undefined,
  wide: styles.wide,
  specimen: styles.specimen,
};

/**
 * The archive's modal surface. Radix Dialog supplies focus trapping, focus
 * return, Escape and scroll locking; everything visible is Retr0Vault's own
 * paper geometry. Deliberately un-animated beyond the scrim.
 */
export function ModalSurface({
  open,
  onOpenChange,
  label,
  media,
  footer,
  size = "regular",
  titleMode = "hidden",
  showCloseButton = true,
  className,
  children,
}: ModalSurfaceProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <div className={styles.positioner}>
          <Dialog.Content
            aria-describedby={undefined}
            className={cx(styles.surface, sizeClass[size], className)}
          >
            {titleMode === "hidden" ? (
              <Dialog.Title className="rv-visually-hidden">{label}</Dialog.Title>
            ) : null}
            {showCloseButton ? (
              <Dialog.Close className={styles.close} aria-label="Close">
                Close
              </Dialog.Close>
            ) : null}
            {/*
              * The sheet scrolls inside the surface, so the region is named and
              * given a tab stop: without one a keyboard-only reader can reach
              * the footer but never scroll the sheet itself.
              */}
            <div
              role="region"
              aria-label={`${label}, scrollable`}
              tabIndex={0}
              className={styles.scroll}
            >
              {media ? <div className={styles.media}>{media}</div> : null}
              <div className={styles.body}>{children}</div>
            </div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;

/** The dialog's title, for surfaces that render one visibly. */
export const ModalTitle = Dialog.Title;
