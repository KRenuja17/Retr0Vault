import { useState } from "react";

import { MonoLabel } from "@/components/primitives";
import { referenceThumbnailUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";

import styles from "./ReferenceThumbnail.module.css";

export interface ReferenceThumbnailProps {
  readonly referenceId: string;
  readonly title: string;
  readonly eager?: boolean;
}

type ThumbnailState = "loading" | "ready" | "failed";

/**
 * The plate image. Always the thumbnail endpoint, addressed by reference ID —
 * never `thumbnailPath`, and never the full-size original.
 *
 * A missing thumbnail and an unreadable one are the same 404 over HTTP, so both
 * land in the failed branch; either way the plate keeps its size and holds the
 * grid rather than leaving a hole in it.
 */
export function ReferenceThumbnail({
  referenceId,
  title,
  eager = false,
}: ReferenceThumbnailProps) {
  const [state, setState] = useState<ThumbnailState>("loading");

  return (
    <div className={styles.frame}>
      <img
        className={cx(styles.image, state === "ready" && styles.imageReady)}
        src={referenceThumbnailUrl(referenceId)}
        alt={`${title} reference capture`}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        draggable={false}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
      {state === "loading" ? (
        <div className={styles.state} aria-hidden="true" />
      ) : null}
      {state === "failed" ? (
        <div className={cx(styles.state, styles.stateFailed)}>
          <MonoLabel size="micro" tone="muted" uppercase marker="hollow">
            Image unavailable
          </MonoLabel>
        </div>
      ) : null}
    </div>
  );
}
