import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { ClipProcessingStatus } from "@retr0vault/shared";

import { MonoLabel } from "@/components/primitives";
import { motionKeyframeUrl, motionMediaUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";
import { timecode } from "@/lib/motion/format";
import { playback, safePlay } from "@/lib/motion/playback";
import { useReducedMotion, useScrubMode } from "@/lib/motion/preferences";

import styles from "./MotionPlate.module.css";

export interface MotionPlateProps {
  readonly clipId: string | null;
  readonly status: ClipProcessingStatus | null;
  readonly durationMs: number | null;
  readonly keyframeCount: number;
  readonly title: string;
  /** Hovered or focused: the card decides, so the whole plate is the target. */
  readonly active: boolean;
  /**
   * Played by an explicit control (reduced motion). The control lives outside
   * the plate's link, in the card, so no button is nested inside a link.
   */
  readonly explicitPlay?: boolean;
}

/** How far outside the viewport a plate attaches its video source: half a screen each way keeps a 3-column grid to about a dozen sources. */
const NEAR_VIEWPORT_MARGIN = "50% 0px";

function useNearViewport<T extends Element>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const element = ref.current;
    if (element === null || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: NEAR_VIEWPORT_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, near];
}

/**
 * A catalogue plate that moves. At rest it is the poster; hovered or focused it
 * plays the 640 px preview, never more than two plates at a time. With reduced
 * motion it plays only on an explicit PLAY, and in scrub mode the pointer's
 * position sets the time instead of playing.
 *
 * The video source is attached only while the plate is within a viewport of
 * the screen, and removed again when it scrolls away, so a long grid never
 * holds more than a handful of decoders.
 */
export function MotionPlate({ clipId, status, durationMs, keyframeCount, title, active, explicitPlay = false }: MotionPlateProps) {
  const [frameRef, near] = useNearViewport<HTMLDivElement>();
  const video = useRef<HTMLVideoElement>(null);
  const reduced = useReducedMotion();
  const [scrub] = useScrubMode();
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const [flipIndex, setFlipIndex] = useState(0);

  const ready = status === "ready" && clipId !== null;
  const wantsPlay = ready && !failed && !scrub && (reduced ? explicitPlay : active || explicitPlay);

  // A player that pauses itself when the coordinator asks.
  const player = useRef({ pause: () => video.current?.pause() });

  useEffect(() => {
    const element = video.current;
    if (element === null || !near) return undefined;
    if (wantsPlay) {
      playback.start(player.current);
      safePlay(element);
    } else {
      element.pause();
      playback.stop(player.current);
    }
    return undefined;
  }, [wantsPlay, near]);

  useEffect(() => {
    const current = player.current;
    return () => playback.stop(current);
  }, []);

  // Keyframe flip-book when the video itself cannot be played.
  useEffect(() => {
    if (!failed || !active || keyframeCount < 2) return undefined;
    const timer = setInterval(() => setFlipIndex((index) => (index + 1) % keyframeCount), 500);
    return () => clearInterval(timer);
  }, [failed, active, keyframeCount]);

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const element = video.current;
    if (!scrub || !ready || element === null || !Number.isFinite(element.duration)) return;
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
    element.currentTime = fraction * element.duration;
  }

  if (!ready) {
    return (
      <div ref={frameRef} className={styles.frame}>
        <div className={cx(styles.state, status === "failed" && styles.stateFailed)}>
          <MonoLabel size="micro" tone="muted" uppercase marker="hollow">
            {status === "failed" ? "Processing failed" : status === null ? "No recording" : status === "queued" ? "Queued" : "Processing"}
          </MonoLabel>
          {status === "queued" || status === "processing" ? (
            <MonoLabel size="micro" tone="muted">evidence is being built</MonoLabel>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div ref={frameRef} className={styles.frame} onPointerMove={onPointerMove}>
      {failed ? (
        keyframeCount > 0 ? (
          <img
            className={styles.media}
            src={motionKeyframeUrl(clipId, flipIndex % keyframeCount)}
            alt={`${title} motion keyframe`}
            draggable={false}
          />
        ) : (
          <div className={cx(styles.state, styles.stateFailed)}>
            <MonoLabel size="micro" tone="muted" uppercase marker="hollow">Clip unavailable</MonoLabel>
          </div>
        )
      ) : (
        <video
          ref={video}
          className={styles.media}
          poster={motionMediaUrl(clipId, "poster")}
          {...(near ? { src: motionMediaUrl(clipId, "preview") } : {})}
          muted
          loop
          playsInline
          preload="none"
          aria-label={`${title} motion preview`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => setCurrentMs(event.currentTarget.currentTime * 1_000)}
          onError={() => setFailed(true)}
        />
      )}

      <span className={cx(styles.timecode, (playing || scrub) && styles.timecodeLive)} aria-hidden="true">
        {`${timecode(currentMs)} / ${timecode(durationMs)}`}
      </span>
    </div>
  );
}
