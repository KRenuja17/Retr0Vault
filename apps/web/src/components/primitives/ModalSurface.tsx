import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { cx } from "@/lib/cx";

import styles from "./ModalSurface.module.css";

export interface ModalSurfaceProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Accessible name for the dialog; the visible title lives in `children`. */
  readonly label: string;
  /** The reference image or frame strip that leads the modal. */
  readonly media?: ReactNode;
  /** Action row pinned below the scrolling body. */
  readonly footer?: ReactNode;
  readonly wide?: boolean;
  /** Set false to drop the corner close affordance (footer close only). */
  readonly showCloseButton?: boolean;
  readonly className?: string | undefined;
  readonly children: ReactNode;
}

/**
 * The archive's modal surface. Radix Dialog supplies focus trapping, Escape
 * and scroll locking; everything visible is Retr0Vault's own paper geometry.
 * Deliberately un-animated beyond the scrim.
 */
export function ModalSurface({
  open,
  onOpenChange,
  label,
  media,
  footer,
  wide = false,
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
            className={cx(styles.surface, wide && styles.wide, className)}
          >
            <Dialog.Title className="rv-visually-hidden">{label}</Dialog.Title>
            {showCloseButton ? (
              <Dialog.Close className={styles.close} aria-label="Close">
                Close
              </Dialog.Close>
            ) : null}
            {media ? <div className={styles.media}>{media}</div> : null}
            <div className={styles.body}>{children}</div>
            {footer ? <div className={styles.footer}>{footer}</div> : null}
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const ModalClose = Dialog.Close;
