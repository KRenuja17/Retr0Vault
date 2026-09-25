import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MotionClip, MotionStudy } from "@retr0vault/shared";

import {
  ActionButton,
  ActionLink,
  CopyActionButton,
  EditorialHeading,
  ModalSurface,
  ModalTitle,
  MonoLabel,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { motionBurstUrl, motionMediaUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { timecode, TRIGGER_LABELS } from "@/lib/motion/format";
import {
  useMotionClipRemoval,
  useMotionClipRetry,
  useMotionClipUpdate,
  useMotionStudy,
  useMotionStudyRemoval,
} from "@/lib/motion/useMotion";

import { MotionNotes } from "./MotionNotes";
import { MotionPlayer, type SeekRequest } from "./MotionPlayer";
import styles from "./MotionModal.module.css";

export interface MotionModalProps {
  readonly referenceId: string;
  /** `?clip=` and `?t=` from the address, for deep links to a moment. */
  readonly initialClipId: string | null;
  readonly initialMs: number | null;
  readonly onClose: () => void;
  /** Called after the study has been deleted (the reference remains). */
  readonly onDeleted: () => void;
  /** Keeps the address in step with the clip and moment being looked at. */
  readonly onMoment: (clipId: string, ms: number) => void;
}

const ANALYSIS_SECTIONS = [
  ["triggers", "Triggers"],
  ["choreography", "Choreography"],
  ["pacing", "Pacing"],
  ["easing", "Easing"],
  ["cameraAndSpace", "Camera & space"],
  ["typographyMotion", "Type in motion"],
  ["imageTreatment", "Image treatment"],
  ["interaction", "Interaction"],
  ["performance", "Performance"],
  ["avoid", "Avoid"],
] as const;

function describeFailure(error: unknown): { title: string; detail: string } {
  if (error instanceof ApiError && error.isOffline) {
    return { title: "The archive is not answering", detail: "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api." };
  }
  if (error instanceof ApiError && (error.statusCode === 404 || error.statusCode === 400)) {
    return { title: "No motion study here", detail: "This reference has no recordings, or the archive holds no reference under that id." };
  }
  return { title: "That motion study could not be read", detail: error instanceof Error ? error.message : "Something failed between the browser and the local API." };
}

/** Rows for each recording: status, label, order, retry, removal. */
function ClipManager({ study, activeClipId, onSelect }: {
  readonly study: MotionStudy;
  readonly activeClipId: string | null;
  readonly onSelect: (clipId: string) => void;
}) {
  const rename = useMotionClipUpdate(study.referenceId);
  const remove = useMotionClipRemoval();
  const retry = useMotionClipRetry();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const failure = rename.error ?? remove.error ?? retry.error;

  return (
    <section className={styles.clips} aria-label="Recordings">
      <MonoLabel size="small" uppercase className={styles.sectionHead}>{`Recordings · ${study.clips.length} of 4`}</MonoLabel>
      <ol className={styles.clipList}>
        {study.clips.map((clip, index) => (
          <li key={clip.id} className={cx(styles.clipRow, clip.id === activeClipId && styles.clipRowActive)}>
            <MonoLabel size="micro" tone="muted" className={styles.techIndex}>{String(index + 1).padStart(2, "0")}</MonoLabel>
            {editing === clip.id ? (
              <form
                className={styles.clipRename}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (draft.trim().length === 0) return;
                  rename.mutate({ clipId: clip.id, patch: { label: draft.trim() } }, { onSuccess: () => setEditing(null) });
                }}
              >
                <input className={styles.techInput} aria-label="Recording label" maxLength={60} value={draft} onChange={(event) => setDraft(event.target.value)} autoFocus />
                <ActionButton type="submit" variant="solid" size="small" disabled={rename.isPending}>Save</ActionButton>
                <ActionButton variant="quiet" size="small" onClick={() => setEditing(null)}>Cancel</ActionButton>
              </form>
            ) : (
              <button type="button" className={styles.clipName} onClick={() => onSelect(clip.id)} disabled={clip.processingStatus !== "ready"}>
                {clip.label}
              </button>
            )}
            <MonoLabel size="micro" uppercase tone={clip.processingStatus === "failed" ? "soft" : "muted"} className={clip.processingStatus === "failed" ? styles.failedLabel : undefined}>
              {clip.processingStatus === "ready" ? timecode(clip.durationMs) : clip.processingStatus}
            </MonoLabel>
            {confirming === clip.id ? (
              <span className={styles.clipActions} role="group" aria-label={`Remove ${clip.label}?`}>
                <MonoLabel size="micro" uppercase marker="hollow">Remove?</MonoLabel>
                <ActionButton variant="outline" size="small" onClick={() => setConfirming(null)}>Cancel</ActionButton>
                <ActionButton variant="accent" size="small" disabled={remove.isPending} onClick={() => remove.mutate(clip.id, { onSuccess: () => setConfirming(null) })}>
                  Remove
                </ActionButton>
              </span>
            ) : (
              <span className={styles.clipActions}>
                {clip.processingStatus === "failed" ? (
                  <ActionButton variant="outline" size="small" disabled={retry.isPending} onClick={() => retry.mutate(clip.id)}>Retry</ActionButton>
                ) : null}
                <ActionButton variant="quiet" size="small" onClick={() => { setEditing(clip.id); setDraft(clip.label); }}>Rename</ActionButton>
                <ActionButton variant="quiet" size="small" disabled={index === 0 || rename.isPending}
                  onClick={() => rename.mutate({ clipId: clip.id, patch: { sortOrder: index - 1 } })}
                  aria-label={`Move ${clip.label} earlier`}>↑</ActionButton>
                <ActionButton variant="quiet" size="small" disabled={index === study.clips.length - 1 || rename.isPending}
                  onClick={() => rename.mutate({ clipId: clip.id, patch: { sortOrder: index + 1 } })}
                  aria-label={`Move ${clip.label} later`}>↓</ActionButton>
                <ActionButton variant="remove" size="small" onClick={() => setConfirming(clip.id)}>Remove</ActionButton>
              </span>
            )}
            {clip.processingError !== null ? <p className={styles.clipError}>{clip.processingError}</p> : null}
          </li>
        ))}
      </ol>
      {study.clips.length < 4 ? (
        <ActionLink variant="outline" size="small" to={`/add?reference=${study.referenceId}#motion`}>Add a recording</ActionLink>
      ) : null}
      {failure ? <p role="alert" className={styles.inlineError}>{describeIngestFailure(failure, "update").detail}</p> : null}
    </section>
  );
}

function Evidence({ clip }: { readonly clip: MotionClip }) {
  const bursts = clip.evidence?.bursts ?? [];
  const sheets: ReadonlyArray<[string, string]> = [
    [motionMediaUrl(clip.id, "energy"), "Motion-energy timeline"],
    [motionMediaUrl(clip.id, "regions"), "Region map"],
    [motionMediaUrl(clip.id, "contact-sheet"), "Contact sheet of smart keyframes"],
    ...bursts.map((burst): [string, string] => [motionBurstUrl(clip.id, burst.index), `Burst ${burst.index + 1}: ${timecode(burst.startMs, true)}–${timecode(burst.endMs, true)}`]),
  ];
  const events = clip.evidence?.events ?? [];
  return (
    <details className={styles.evidence}>
      <summary className={styles.evidenceSummary}>
        <MonoLabel size="small" uppercase>{`Evidence · ${events.length} events · ${clip.evidence?.cutsMs.length ?? 0} cuts · ${clip.keyframes.length} keyframes · ${bursts.length} bursts`}</MonoLabel>
      </summary>
      <p className={styles.evidenceNote}>
        Computed from the recording at {clip.evidence?.sampleFps ?? 10} samples a second. Spread, locality and still rows are measurements, not conclusions.
      </p>
      {events.length > 0 ? (
        <ol className={styles.eventList}>
          {events.map((event) => (
            <li key={event.index} className={styles.eventRow}>
              <MonoLabel size="micro" className={styles.eventId}>{`E${event.index + 1}`}</MonoLabel>
              <MonoLabel size="micro" tone="soft">{`${timecode(event.onsetMs, true)} → ${timecode(event.peakMs, true)} → ${timecode(event.settleMs, true)}`}</MonoLabel>
              <MonoLabel size="micro" tone="muted">
                {`${event.locality} · spread ${event.spread.toFixed(2)}${event.stillBand ? ` · still rows ${event.stillBand.fromRow}–${event.stillBand.toRow}` : ""}`}
              </MonoLabel>
            </li>
          ))}
        </ol>
      ) : null}
      <div className={styles.sheets}>
        {sheets.map(([url, label]) => (
          <figure key={url} className={styles.sheet}>
            <a href={url} target="_blank" rel="noreferrer">
              <img src={url} alt={label} loading="lazy" decoding="async" className={styles.sheetImage} />
            </a>
            <figcaption><MonoLabel size="micro" tone="muted" uppercase>{label}</MonoLabel></figcaption>
          </figure>
        ))}
      </div>
    </details>
  );
}

function StudyActions({ study, onClose, onDeleted }: {
  readonly study: MotionStudy | undefined;
  readonly onClose: () => void;
  readonly onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const remove = useMotionStudyRemoval();
  const cancel = useRef<HTMLButtonElement>(null);
  const promptId = useId();
  useEffect(() => {
    if (confirming) cancel.current?.focus();
  }, [confirming]);

  if (confirming && study !== undefined) {
    return (
      <>
        <div role="group" aria-labelledby={promptId} className={styles.confirmRow}>
          <MonoLabel id={promptId} size="small" uppercase marker="hollow">Delete this motion study and its recordings?</MonoLabel>
          <ActionButton ref={cancel} variant="outline" disabled={remove.isPending} onClick={() => setConfirming(false)}>Cancel</ActionButton>
          <ActionButton variant="accent" disabled={remove.isPending} onClick={() => remove.mutate(study.referenceId, { onSuccess: onDeleted })}>
            {remove.isPending ? "Deleting…" : "Delete"}
          </ActionButton>
        </div>
        {remove.isError ? <p role="alert" className={styles.inlineError}>{describeIngestFailure(remove.error, "update").detail}</p> : null}
      </>
    );
  }

  const brief = study?.motionBrief?.trim() ?? "";
  return (
    <>
      {study === undefined ? null : (
        <>
          <CopyActionButton
            label="Copy motion brief"
            text={brief}
            variant="solid"
            title={brief.length > 0 ? "Copy the motion brief for a coding agent" : "No motion brief filed yet"}
          />
          <ActionLink variant="outline" to={`/reference/${study.referenceId}`}>View design analysis</ActionLink>
          <ActionButton variant="remove" onClick={() => setConfirming(true)} title="Remove the recordings and motion analysis; the reference stays">
            Delete motion study
          </ActionButton>
        </>
      )}
      <ActionButton variant="outline" onClick={onClose}>Close</ActionButton>
    </>
  );
}

/**
 * The motion sheet, raised over the Motion grid.
 *
 *   [ player · energy-strip scrubber · clip tabs ]
 *   Title                                              motion DNA
 *   Motion thesis
 *   [technique] [technique] …
 *   BEATS  00:00.00–00:02.80  LOAD   ASCII loader …
 *   IMPLEMENTATION · EVIDENCE · NOTES · RECORDINGS · MOTION BRIEF
 *   COPY MOTION BRIEF  VIEW DESIGN ANALYSIS  DELETE MOTION STUDY  CLOSE
 */
export function MotionModal({ referenceId, initialClipId, initialMs, onClose, onDeleted, onMoment }: MotionModalProps) {
  const study = useMotionStudy(referenceId);
  const data = study.data;
  const readyClips = useMemo(() => data?.clips.filter((clip) => clip.processingStatus === "ready") ?? [], [data]);
  const [clipId, setClipId] = useState<string | null>(initialClipId);
  const [seek, setSeek] = useState<SeekRequest | null>(initialMs === null ? null : { ms: initialMs, nonce: 0 });
  const nonce = useRef(1);
  const stage = useRef<HTMLDivElement>(null);

  const activeClip = readyClips.find((clip) => clip.id === clipId) ?? readyClips[0];

  const selectClip = (id: string, ms = 0, reveal = false) => {
    setClipId(id);
    setSeek({ ms, nonce: nonce.current++ });
    onMoment(id, ms);
    // A beat is read further down the sheet; bring the player back into view to see it.
    if (reveal) stage.current?.scrollIntoView?.({ block: "start" });
  };

  const pending = data?.motionStatus === "pending";

  return (
    <ModalSurface
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={data ? `${data.reference.title} motion study` : "Motion study"}
      size="specimen"
      titleMode={data ? "provided" : "hidden"}
      showCloseButton={false}
      {...(activeClip && data ? {
        media: (
          <div ref={stage} className={styles.stage}>
            {readyClips.length > 1 ? (
              <div className={styles.tabs} role="tablist" aria-label="Recordings">
                {readyClips.map((clip) => (
                  <button
                    key={clip.id}
                    type="button"
                    role="tab"
                    aria-selected={clip.id === activeClip.id}
                    className={cx(styles.tab, clip.id === activeClip.id && styles.tabActive)}
                    onClick={() => selectClip(clip.id)}
                  >
                    {clip.label}
                  </button>
                ))}
              </div>
            ) : null}
            <MotionPlayer
              key={activeClip.id}
              clip={activeClip}
              title={data.reference.title}
              beats={data.beats}
              seek={seek}
              onTime={(ms) => onMoment(activeClip.id, ms)}
            />
          </div>
        ),
      } : {})}
      footer={<StudyActions study={data} onClose={onClose} onDeleted={onDeleted} />}
    >
      {study.isPending ? (
        <div aria-hidden="true" className={styles.loading}>
          <MonoLabel size="small" tone="muted" uppercase>Reading motion study</MonoLabel>
        </div>
      ) : study.isError ? (
        <div className={styles.state}>
          <EditorialHeading level={2} scale="section" marker>{describeFailure(study.error).title}</EditorialHeading>
          <p className={styles.thesis}>{describeFailure(study.error).detail}</p>
        </div>
      ) : data ? (
        <>
          <div className={styles.masthead}>
            <ModalTitle className={styles.title}>{data.reference.title}</ModalTitle>
            {pending ? (
              <MonoLabel size="small" uppercase marker="hollow" tone="soft">Awaiting motion analysis</MonoLabel>
            ) : data.motionDNA ? (
              <span className={styles.dna}>{data.motionDNA}</span>
            ) : null}
          </div>

          {readyClips.length === 0 ? (
            <p className={styles.thesis}>
              {data.clips.some((clip) => clip.processingStatus === "failed")
                ? "The recordings could not be processed. Retry or replace them below."
                : "The recordings are being processed. The player, energy strip and evidence appear here when they are ready."}
            </p>
          ) : null}

          {data.motionThesis ? <p className={styles.thesis}>{data.motionThesis}</p> : null}

          {data.techniques.length > 0 ? (
            <VocabularyChipSet className={styles.vocabulary}>
              {data.techniques.map((technique) => (
                <VocabularyChip key={`${technique.type}:${technique.normalizedValue}`} wrap title={`${technique.type}: ${technique.value}`}>
                  {technique.value}
                </VocabularyChip>
              ))}
            </VocabularyChipSet>
          ) : null}

          {data.beats.length > 0 ? (
            <section className={styles.beats} aria-label="Beat timeline">
              <MonoLabel size="small" uppercase className={styles.sectionHead}>Beats</MonoLabel>
              <ol className={styles.beatList}>
                {data.beats.map((beat, index) => {
                  const clip = data.clips.find((candidate) => candidate.id === beat.clipId);
                  return (
                    <li key={`${beat.clipId}-${index}`} className={styles.beatRow}>
                      <button type="button" className={styles.beatSeek} onClick={() => selectClip(beat.clipId, beat.startMs, true)} disabled={clip?.processingStatus !== "ready"}>
                        <span className={styles.beatTime}>
                          {`${timecode(beat.startMs, true)}${beat.endMs === null ? "" : `–${timecode(beat.endMs, true)}`}`}
                        </span>
                        <span className={styles.beatTrigger}>{TRIGGER_LABELS[beat.trigger]}</span>
                        <span className={styles.beatLabel}>{beat.label}</span>
                      </button>
                      <p className={styles.beatDescription}>
                        {readyClips.length > 1 && clip ? <span className={styles.beatClip}>{clip.label} · </span> : null}
                        {beat.description}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}

          {data.analysis ? (
            <dl className={styles.analysis}>
              {ANALYSIS_SECTIONS.filter(([key]) => data.analysis![key].length > 0).map(([key, label]) => (
                <div key={key} className={styles.analysisRow}>
                  <dt><MonoLabel size="micro" uppercase tone="muted">{label}</MonoLabel></dt>
                  <dd>
                    <ul className={styles.analysisItems}>
                      {data.analysis![key].map((item) => <li key={item}>{item}</li>)}
                    </ul>
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {data.implementation.length > 0 ? (
            <section className={styles.implementation} aria-label="Implementation">
              <MonoLabel size="small" uppercase className={styles.sectionHead}>Implementation</MonoLabel>
              <ul className={styles.claimList}>
                {data.implementation.map((claim, index) => {
                  const source = claim.verifiedTechIndex === null ? undefined : data.verifiedTech[claim.verifiedTechIndex];
                  return (
                    <li key={index} className={styles.claim}>
                      <MonoLabel size="micro" uppercase className={claim.evidence === "verified" ? styles.verified : styles.inferred}>
                        {claim.evidence === "verified" ? "Verified" : "Inferred"}
                      </MonoLabel>
                      <span>{claim.claim}</span>
                      {source ? <MonoLabel size="micro" tone="muted">{`— ${source.claim} (${source.source})`}</MonoLabel> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {activeClip ? <Evidence clip={activeClip} /> : null}

          <div className={styles.recipe}>
            <MonoLabel size="small" uppercase className={styles.recipeHead}>Motion brief — for a coding agent</MonoLabel>
            {data.motionBrief ? (
              <div className={styles.recipeBody}>{data.motionBrief}</div>
            ) : (
              <MonoLabel size="small" tone="muted" uppercase className={styles.absent}>No motion brief filed</MonoLabel>
            )}
          </div>

          <MotionNotes study={data} />
          <ClipManager study={data} activeClipId={activeClip?.id ?? null} onSelect={(id) => selectClip(id)} />
        </>
      ) : null}
    </ModalSurface>
  );
}
