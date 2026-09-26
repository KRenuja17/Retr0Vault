import { useEffect, useRef, useState } from "react";

import { motionMediaUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";
import { safePlay } from "@/lib/motion/playback";
import { useReducedMotion } from "@/lib/motion/preferences";
import { NEAR_VIEWPORT_MARGIN, useInView } from "@/lib/motion/viewport";

import type { CatalogueReference } from "./ReferenceCard";
import { ReferenceThumbnail } from "./ReferenceThumbnail";
import styles from "./ReferencePreview.module.css";

export interface ReferencePreviewProps {
  readonly reference: CatalogueReference;
  readonly eager?: boolean;
}

/**
 * The picture on a catalogue plate. The screenshot is always there; when the
 * reference has a processed motion clip, that clip loops over it, muted, for as
 * long as the plate is on screen. Until the clip is actually playing (or if it
 * cannot play, or the reader prefers reduced motion) the screenshot is what
 * shows, so a plate is never blank.
 */
export function ReferencePreview({ reference, eager = false }: ReferencePreviewProps) {
  const clipId = reference.motion?.previewClipId ?? null;
  const reduced = useReducedMotion();

  return (
    <>
      <ReferenceThumbnail referenceId={reference.id} title={reference.title} eager={eager} version={reference.updatedAt} />
      {clipId === null || reduced ? null : <LoopingClip clipId={clipId} title={reference.title} />}
    </>
  );
}

function LoopingClip({ clipId, title }: { readonly clipId: string; readonly title: string }) {
  // The source attaches within half a screen of the viewport; playback runs only while visible.
  // Both observers watch the wrapper, which is always mounted; the video is not.
  const [nearRef, near] = useInView<HTMLDivElement>({ rootMargin: NEAR_VIEWPORT_MARGIN });
  const [visibleRef, visible] = useInView<HTMLDivElement>({ threshold: 0.2 });
  const video = useRef<HTMLVideoElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const element = video.current;
    // Scrolled away, the video is removed; the next one it mounts must stay
    // hidden behind the screenshot until it is playing too.
    if (!near) setPlaying(false);
    if (element === null || !near) return;
    if (visible) safePlay(element);
    else element.pause();
  }, [near, visible]);

  if (failed) return null;

  return (
    <div
      ref={(element) => {
        nearRef.current = element;
        visibleRef.current = element;
      }}
      className={styles.frame}
      aria-hidden="true"
    >
      {near ? (
        <video
          ref={video}
          className={cx(styles.clip, playing && styles.clipPlaying)}
          src={motionMediaUrl(clipId, "preview")}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label={`${title} motion preview`}
          onPlaying={() => setPlaying(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}
