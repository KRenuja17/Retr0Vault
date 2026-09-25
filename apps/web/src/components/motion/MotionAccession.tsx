import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ReferenceResponse } from "@retr0vault/shared";

import { ActionButton, ActionLink, EditorialHeading, MonoLabel } from "@/components/primitives";
import { fetchReference, fetchReferences } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/queryKeys";
import { cx } from "@/lib/cx";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { formatBytes } from "@/lib/ingest/validation";
import { timecode } from "@/lib/motion/format";
import { useMotionStudy, useMotionStudyUpdate, useMotionUpload } from "@/lib/motion/useMotion";

import { TextAreaField, TextField } from "@/components/ingest/Field";
import ingest from "@/components/ingest/Ingest.module.css";
import styles from "./MotionAccession.module.css";

/** The API's defaults: the server enforces them again whatever the browser says. */
export const MAX_RECORDING_BYTES = 300 * 1_024 * 1_024;
export const MAX_RECORDING_SECONDS = 60;
export const RECORDING_ACCEPT = "video/mp4,video/quicktime,video/webm,video/x-matroska,.mp4,.mov,.webm,.mkv,.m4v";

export function validateRecordingFile(file: File): string | null {
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_RECORDING_BYTES) return `Recordings are limited to ${formatBytes(MAX_RECORDING_BYTES)}; that file is ${formatBytes(file.size)}.`;
  const looksLikeVideo = file.type.startsWith("video/") || /\.(mp4|mov|webm|mkv|m4v)$/iu.test(file.name);
  return looksLikeVideo ? null : "Choose a screen recording: MP4, MOV, WebM or MKV.";
}

function ReferencePicker({ selected, onSelect }: {
  readonly selected: ReferenceResponse | null;
  readonly onSelect: (reference: ReferenceResponse | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const inputId = useId();
  const results = useQuery({
    queryKey: ["references", "motion-picker", submitted],
    queryFn: ({ signal }) => fetchReferences({ limit: 8, sort: submitted ? "relevance" : "newest", ...(submitted ? { q: submitted } : {}) }, signal),
    enabled: selected === null,
  });

  if (selected !== null) {
    return (
      <div className={styles.chosen}>
        <MonoLabel size="micro" tone="muted" uppercase>Recording for</MonoLabel>
        <p className={styles.chosenTitle}>{selected.title}</p>
        <MonoLabel size="micro" tone="muted">
          {[selected.sourceUrl, selected.motion ? `${selected.motion.clipCount} of 4 recordings` : "no recordings yet"].filter(Boolean).join(" · ")}
        </MonoLabel>
        <ActionButton variant="quiet" size="small" onClick={() => onSelect(null)}>Choose another reference</ActionButton>
      </div>
    );
  }

  return (
    <div className={styles.picker}>
      <div className={styles.pickerSearch}>
        <label htmlFor={inputId} className="rv-visually-hidden">Find the reference to attach the recording to</label>
        <input
          id={inputId}
          className={cx(ingest.control, ingest.controlMono)}
          type="search"
          value={query}
          placeholder="Find a reference: title, DNA, source…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              setSubmitted(query.trim());
            }
          }}
        />
        <ActionButton variant="outline" size="small" onClick={() => setSubmitted(query.trim())}>Find</ActionButton>
      </div>
      {results.isPending ? (
        <MonoLabel size="micro" tone="muted" uppercase>Reading the archive</MonoLabel>
      ) : results.isError ? (
        <MonoLabel size="small" className={ingest.fieldError}>{describeIngestFailure(results.error, "read").detail}</MonoLabel>
      ) : results.data.items.length === 0 ? (
        <MonoLabel size="small" tone="muted">No reference matches. Capture the site first, then attach its recording.</MonoLabel>
      ) : (
        <ul className={styles.pickerList} aria-label="References">
          {results.data.items.map((reference) => (
            <li key={reference.id}>
              <button type="button" className={styles.pickerItem} onClick={() => onSelect(reference)}>
                <span className={styles.pickerTitle}>{reference.title}</span>
                <MonoLabel size="micro" tone="muted">
                  {reference.motion ? `◉ ${reference.motion.clipCount} recording${reference.motion.clipCount === 1 ? "" : "s"}` : reference.sourceUrl ?? reference.sourceType}
                </MonoLabel>
              </button>
            </li>
          ))}
        </ul>
      )}
      <ActionLink variant="quiet" size="small" to="/add#website">Capture website first</ActionLink>
    </div>
  );
}

/** Live processing status of the recording that was just filed. */
function ProcessingOutcome({ referenceId, clipId, onDismiss }: {
  readonly referenceId: string;
  readonly clipId: string;
  readonly onDismiss: () => void;
}) {
  const study = useMotionStudy(referenceId);
  const clip = study.data?.clips.find((candidate) => candidate.id === clipId);
  const status = clip?.processingStatus ?? "queued";
  return (
    <div className={cx(ingest.notice, status === "failed" && ingest.noticeFailure)} role="status">
      <MonoLabel size="small" uppercase marker="hollow" className={status === "failed" ? ingest.statusFailed : ingest.statusPending}>
        {status === "ready" ? "Ready · awaiting motion analysis" : status === "failed" ? "Processing failed" : status === "processing" ? "Processing" : "Queued"}
      </MonoLabel>
      <p className={ingest.noticeTitle}>{`${study.data?.reference.title ?? "Recording"} — ${clip?.label ?? "new recording"}`}</p>
      <p className={ingest.noticeBody}>
        {status === "ready"
          ? `Normalized, previewed and measured: ${clip?.evidence?.events.length ?? 0} events, ${clip?.keyframes.length ?? 0} keyframes, ${clip?.evidence?.bursts.length ?? 0} burst strips. Export the pending motion manifest when you are ready to analyse it.`
          : status === "failed"
            ? clip?.processingError ?? "The recording could not be processed."
            : "ffmpeg is normalizing the recording and building its evidence: energy timeline, region maps, keyframes and bursts. This page updates by itself."}
      </p>
      <div className={ingest.noticeLinks}>
        <ActionLink variant="outline" size="small" to={`/motion/${referenceId}`}>Open the motion sheet</ActionLink>
        <ActionLink variant="quiet" size="small" to="/motion">View all motion</ActionLink>
        <ActionButton variant="quiet" size="small" onClick={onDismiss}>Dismiss</ActionButton>
      </div>
    </div>
  );
}

/**
 * The motion lane on /add: attach a screen recording to a reference already in
 * the archive. The recording is stored and processed on this machine by the
 * bundled ffmpeg; nothing is uploaded anywhere else.
 */
export function MotionAccession() {
  const [searchParams] = useSearchParams();
  const presetId = searchParams.get("reference");
  const upload = useMotionUpload();
  const [reference, setReference] = useState<ReferenceResponse | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [durationS, setDurationS] = useState<number | null>(null);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [posterS, setPosterS] = useState(1);
  const [notes, setNotes] = useState("");
  const [filed, setFiled] = useState<{ referenceId: string; clipId: string } | null>(null);
  const notesUpdate = useMotionStudyUpdate(reference?.id ?? "");
  const preview = useRef<HTMLVideoElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const headingId = useId();

  const preset = useQuery({
    queryKey: queryKeys.reference(presetId ?? ""),
    queryFn: ({ signal }) => fetchReference(presetId!, signal),
    enabled: presetId !== null && reference === null,
  });
  useEffect(() => {
    // Adopt the preset once, when it arrives; a later choice is the reader's.
    if (preset.data !== undefined) setReference((current) => current ?? preset.data);
  }, [preset.data]);

  useEffect(() => () => {
    if (previewUrl !== null) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const clear = useCallback(() => {
    setFile(null);
    setPreviewUrl(null);
    setDurationS(null);
    setDimensions(null);
    setRejection(null);
    setPosterS(1);
    if (fileInput.current !== null) fileInput.current.value = "";
  }, []);

  function choose(next: File | undefined) {
    upload.reset();
    if (next === undefined) return;
    const problem = validateRecordingFile(next);
    setRejection(problem);
    if (problem !== null) {
      setFile(null);
      return;
    }
    setFile(next);
    setDurationS(null);
    setDimensions(null);
    setPreviewUrl(typeof URL.createObjectURL === "function" ? URL.createObjectURL(next) : null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reference === null || file === null || upload.isPending) return;
    if (durationS !== null && durationS > MAX_RECORDING_SECONDS + 0.5) {
      setRejection(`Recordings are limited to ${MAX_RECORDING_SECONDS} seconds; this one runs ${Math.round(durationS)} s.`);
      return;
    }
    const referenceId = reference.id;
    upload.mutate(
      { referenceId, file, label: label.trim() || undefined, posterMs: Math.round(posterS * 1_000) },
      {
        onSuccess: (study) => {
          // The clip just filed is the study's newest.
          const added = [...study.clips].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
          // Keep the chosen reference's count honest for the next recording.
          setReference((current) => current === null ? null : {
            ...current,
            motion: {
              studyId: study.id,
              status: study.motionStatus,
              clipCount: study.clips.length,
              readyClipCount: study.clips.filter((clip) => clip.processingStatus === "ready").length,
              primaryClipId: study.clips[0]?.id ?? null,
              durationMs: study.clips[0]?.durationMs ?? null,
            },
          });
          if (added !== undefined) setFiled({ referenceId, clipId: added.id });
          if (notes.trim().length > 0) {
            notesUpdate.mutate({
              inspectionNotes: [study.inspectionNotes, notes.trim()].filter(Boolean).join("\n\n"),
            });
          }
          clear();
          setLabel("");
          setNotes("");
        },
      },
    );
  }

  const failure = upload.isError ? describeIngestFailure(upload.error, "recording") : null;
  const full = (reference?.motion?.clipCount ?? 0) >= 4;

  return (
    <section id="motion" className={ingest.lane} aria-labelledby={headingId}>
      <header className={ingest.laneHead}>
        <MonoLabel size="small" uppercase marker="square">Motion recording</MonoLabel>
        <EditorialHeading level={2} scale="section" id={headingId}>Attach a screen recording</EditorialHeading>
        <p className={ingest.laneNote}>
          A recording of a site you already hold, up to {MAX_RECORDING_SECONDS} seconds and {formatBytes(MAX_RECORDING_BYTES)}.
          It is normalized and measured on this machine by the bundled ffmpeg; the reference keeps its design analysis in the catalogue.
        </p>
      </header>

      <form className={ingest.form} onSubmit={onSubmit} noValidate>
        <ReferencePicker selected={reference} onSelect={(next) => { setReference(next); setFiled(null); }} />

        <div role="group" aria-label="Recording" className={ingest.specimen}>
          {file === null ? (
            <div className={ingest.specimenLegend}>
              <MonoLabel size="small" tone="soft" uppercase marker="hollow">No recording mounted</MonoLabel>
              <MonoLabel size="micro" tone="muted" uppercase>MP4 · MOV · WebM · MKV</MonoLabel>
            </div>
          ) : (
            <figure className={styles.preview}>
              {previewUrl === null ? (
                <MonoLabel size="small" tone="muted" uppercase marker="hollow">Preview unavailable in this browser</MonoLabel>
              ) : (
                <video
                  ref={preview}
                  className={styles.previewVideo}
                  src={previewUrl}
                  muted
                  playsInline
                  preload="metadata"
                  aria-label={`Preview of ${file.name}`}
                  onLoadedMetadata={(event) => {
                    const element = event.currentTarget;
                    if (Number.isFinite(element.duration)) {
                      setDurationS(element.duration);
                      setPosterS(Math.min(1, element.duration / 2));
                      element.currentTime = Math.min(1, element.duration / 2);
                      if (element.duration > MAX_RECORDING_SECONDS + 0.5) {
                        setRejection(`Recordings are limited to ${MAX_RECORDING_SECONDS} seconds; this one runs ${Math.round(element.duration)} s.`);
                      }
                    }
                    if (element.videoWidth > 0) setDimensions(`${element.videoWidth} × ${element.videoHeight}`);
                  }}
                />
              )}
              <figcaption className={ingest.previewMeta}>
                <MonoLabel size="small" tone="soft">{file.name}</MonoLabel>
                <MonoLabel size="micro" tone="muted" uppercase>
                  {[dimensions, durationS === null ? null : timecode(durationS * 1_000, true), formatBytes(file.size)].filter(Boolean).join(" · ")}
                </MonoLabel>
              </figcaption>
            </figure>
          )}
          <div className={ingest.specimenActions}>
            <input
              ref={fileInput}
              id={fileInputId}
              className={ingest.fileInput}
              type="file"
              accept={RECORDING_ACCEPT}
              disabled={upload.isPending}
              onChange={(event) => choose(event.target.files?.[0])}
            />
            <label className={ingest.picker} htmlFor={fileInputId}>{file === null ? "Choose recording" : "Replace recording"}</label>
            {file === null ? null : (
              <ActionButton variant="quiet" size="small" onClick={clear} disabled={upload.isPending}>Remove</ActionButton>
            )}
          </div>
        </div>

        {rejection === null ? null : (
          <MonoLabel size="small" className={ingest.fieldError} role="alert">{rejection}</MonoLabel>
        )}

        {file !== null && durationS !== null ? (
          <div className={styles.posterField}>
            <label htmlFor={`${fileInputId}-poster`}>
              <MonoLabel size="small" uppercase>{`Poster frame · ${timecode(posterS * 1_000, true)}`}</MonoLabel>
            </label>
            <input
              id={`${fileInputId}-poster`}
              className={styles.posterRange}
              type="range"
              min={0}
              max={Math.max(0, durationS - 0.05)}
              step={0.05}
              value={posterS}
              disabled={upload.isPending}
              onChange={(event) => {
                const next = Number(event.target.value);
                setPosterS(next);
                if (preview.current !== null) preview.current.currentTime = next;
              }}
            />
            <MonoLabel size="micro" tone="muted">The still shown on the plate before it plays.</MonoLabel>
          </div>
        ) : null}

        <div className={ingest.formGrid}>
          <TextField
            label="Label"
            note="Optional"
            value={label}
            onChange={setLabel}
            placeholder={reference?.motion ? (full ? "No slots left" : `Clip ${reference.motion.clipCount + 1}`) : "Primary"}
            disabled={upload.isPending}
            hint="One behaviour per recording: Hero cursor, Scroll journey, Load."
          />
          <TextAreaField
            label="Inspection notes"
            note="Optional"
            value={notes}
            onChange={setNotes}
            rows={3}
            disabled={upload.isPending}
            hint="What you saw and checked live: cursor response, DevTools findings. Verified tech is itemized on the motion sheet."
          />
        </div>

        <div className={ingest.actions}>
          <ActionButton type="submit" variant="solid" disabled={reference === null || full || file === null || rejection !== null || upload.isPending}>
            {upload.isPending ? "Uploading" : "File this recording"}
          </ActionButton>
          <MonoLabel size="micro" tone="muted" uppercase className={ingest.actionsNote}>
            {reference === null ? "Choose a reference first" : full ? "This study holds four recordings" : file === null ? "No recording mounted" : upload.isPending ? "Copying to local storage" : "Processed in the background"}
          </MonoLabel>
        </div>
      </form>

      {failure !== null ? (
        <div className={cx(ingest.notice, ingest.noticeFailure)} role="alert">
          <MonoLabel size="small" uppercase marker="hollow" className={ingest.statusFailed}>Not filed</MonoLabel>
          <p className={ingest.noticeTitle}>{failure.headline}</p>
          <p className={ingest.noticeBody}>{failure.detail}</p>
          {failure.hint === undefined ? null : <MonoLabel size="small" tone="soft">{failure.hint}</MonoLabel>}
          {failure.signature === undefined ? null : <MonoLabel size="micro" tone="muted">{failure.signature}</MonoLabel>}
          <div className={ingest.noticeLinks}>
            <ActionButton variant="outline" size="small" onClick={() => upload.reset()}>Dismiss</ActionButton>
          </div>
        </div>
      ) : filed !== null ? (
        <ProcessingOutcome referenceId={filed.referenceId} clipId={filed.clipId} onDismiss={() => setFiled(null)} />
      ) : null}
    </section>
  );
}
