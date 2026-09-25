import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import type { MotionBeat, MotionClip } from "@retr0vault/shared";

import { MonoLabel } from "@/components/primitives";
import { motionMediaUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";
import { timecode } from "@/lib/motion/format";
import { safePlay } from "@/lib/motion/playback";
import { useClipEnergy } from "@/lib/motion/useMotion";

import styles from "./MotionModal.module.css";

export interface SeekRequest {
  readonly ms: number;
  /** Changes on every request, so seeking to the same time twice still seeks. */
  readonly nonce: number;
}

export interface MotionPlayerProps {
  readonly clip: MotionClip;
  readonly title: string;
  readonly beats: readonly MotionBeat[];
  readonly seek: SeekRequest | null;
  readonly onTime: (ms: number) => void;
}

const STEP_MS = 1_000;

/**
 * The sheet's player. The scrub bar is the clip's motion-energy strip: the
 * measured curve under the playhead, event windows shaded, beat ticks above.
 * Seeking needs byte ranges, which the clip route serves.
 */
export function MotionPlayer({ clip, title, beats, seek, onTime }: MotionPlayerProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [failed, setFailed] = useState(false);
  const energy = useClipEnergy(clip.id);
  const durationMs = clip.durationMs ?? 0;

  useEffect(() => {
    const element = video.current;
    if (seek === null || element === null) return undefined;
    const apply = () => {
      element.currentTime = Math.min(durationMs, Math.max(0, seek.ms)) / 1_000;
      setCurrentMs(seek.ms);
    };
    // A deep link arrives before the metadata: seek once the browser can.
    if (element.readyState >= 1) {
      apply();
      return undefined;
    }
    element.addEventListener("loadedmetadata", apply, { once: true });
    return () => element.removeEventListener("loadedmetadata", apply);
  }, [seek, durationMs]);

  const seekTo = (ms: number) => {
    const element = video.current;
    const clamped = Math.min(durationMs, Math.max(0, ms));
    if (element !== null) element.currentTime = clamped / 1_000;
    setCurrentMs(clamped);
    onTime(clamped);
  };

  const toggle = () => {
    const element = video.current;
    if (element === null) return;
    if (element.paused) safePlay(element);
    else element.pause();
  };

  const pointerSeek = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    seekTo(((event.clientX - box.left) / Math.max(1, box.width)) * durationMs);
  };

  const onStripKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: -STEP_MS, ArrowRight: STEP_MS, ArrowDown: -STEP_MS, ArrowUp: STEP_MS,
      PageDown: -5 * STEP_MS, PageUp: 5 * STEP_MS,
    };
    if (event.key in moves) {
      event.preventDefault();
      seekTo(currentMs + moves[event.key]!);
    } else if (event.key === "Home") {
      event.preventDefault();
      seekTo(0);
    } else if (event.key === "End") {
      event.preventDefault();
      seekTo(durationMs);
    } else if (event.key === " " || event.key === "k") {
      event.preventDefault();
      toggle();
    }
  };

  const values = energy.data?.energy ?? [];
  const sampleMs = energy.data === undefined ? 100 : 1_000 / energy.data.sampleFps;
  const peak = Math.max(0.02, ...values, (clip.evidence?.threshold ?? 0.01) * 2);
  const x = (ms: number) => (durationMs > 0 ? (Math.min(durationMs, Math.max(0, ms)) / durationMs) * 1_000 : 0);
  const points = values.map((value, index) => `${x(index * sampleMs).toFixed(1)},${(100 - (value / peak) * 92).toFixed(1)}`).join(" ");
  const clipBeats = beats.filter((beat) => beat.clipId === clip.id);

  return (
    <div className={styles.player}>
      <div className={styles.screen}>
        {failed ? (
          <div className={styles.screenState}>
            <MonoLabel size="small" tone="muted" uppercase marker="hollow">Recording unavailable</MonoLabel>
          </div>
        ) : (
          <video
            ref={video}
            className={styles.video}
            src={motionMediaUrl(clip.id, "clip")}
            poster={motionMediaUrl(clip.id, "poster")}
            muted
            playsInline
            preload="metadata"
            aria-label={`${title}: ${clip.label}`}
            onClick={toggle}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const ms = event.currentTarget.currentTime * 1_000;
              setCurrentMs(ms);
              onTime(ms);
            }}
            onError={() => setFailed(true)}
          />
        )}
      </div>

      <div className={styles.controls}>
        <button type="button" className={styles.control} onClick={toggle} disabled={failed} aria-pressed={playing}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </button>
        <MonoLabel size="small" className={styles.clock}>
          {`${timecode(currentMs, true)} / ${timecode(durationMs, true)}`}
        </MonoLabel>
        <MonoLabel size="micro" tone="muted" uppercase className={styles.controlsNote}>
          {`${clip.width ?? "?"} × ${clip.height ?? "?"} · ${clip.fps ?? "?"} fps · ${clip.sourceFormat ?? "unknown source"}`}
        </MonoLabel>
      </div>

      {/* The scrub bar is the energy strip. A slider to assistive technology. */}
      <div
        className={styles.strip}
        role="slider"
        tabIndex={0}
        aria-label={`Seek ${clip.label}. The strip shows how much the picture changes over time.`}
        aria-valuemin={0}
        aria-valuemax={Math.round(durationMs / 1_000)}
        aria-valuenow={Math.round(currentMs / 1_000)}
        aria-valuetext={timecode(currentMs, true)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          pointerSeek(event);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 1) pointerSeek(event);
        }}
        onKeyDown={onStripKey}
      >
        <svg className={styles.stripGraph} viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
          {(clip.evidence?.events ?? []).map((event) => (
            <rect key={event.index} x={x(event.onsetMs)} y={0} width={Math.max(2, x(event.settleMs) - x(event.onsetMs))} height={100} className={styles.stripEvent} />
          ))}
          {(clip.evidence?.cutsMs ?? []).map((cut) => (
            <line key={`cut-${cut}`} x1={x(cut)} x2={x(cut)} y1={0} y2={100} className={styles.stripCut} />
          ))}
          {points.length > 0 ? <polyline points={points} className={styles.stripCurve} /> : null}
          <line x1={x(currentMs)} x2={x(currentMs)} y1={0} y2={100} className={styles.stripHead} />
        </svg>
        {clipBeats.map((beat) => (
          <span
            key={`${beat.startMs}-${beat.label}`}
            className={cx(styles.stripBeat, currentMs >= beat.startMs && (beat.endMs === null || currentMs <= beat.endMs) && styles.stripBeatActive)}
            style={{ left: `${x(beat.startMs) / 10}%` }}
            title={`${timecode(beat.startMs, true)} ${beat.label}`}
            aria-hidden="true"
          />
        ))}
      </div>
      <div className={styles.stripLegend} aria-hidden="true">
        <MonoLabel size="micro" tone="muted" uppercase>Motion energy</MonoLabel>
        <MonoLabel size="micro" tone="muted">
          {energy.isError ? "curve unavailable" : "shaded = event · rule = cut · tick = beat · ← → seek 1 s"}
        </MonoLabel>
      </div>
    </div>
  );
}
