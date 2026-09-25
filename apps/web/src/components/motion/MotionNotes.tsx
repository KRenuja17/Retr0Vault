import { useEffect, useId, useState } from "react";
import type { MotionStudy, VerifiedTechEntry } from "@retr0vault/shared";

import { ActionButton, MonoLabel } from "@/components/primitives";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { useMotionStudyUpdate } from "@/lib/motion/useMotion";

import styles from "./MotionModal.module.css";

/**
 * Inspection notes and verified tech: what the person recording actually saw
 * and checked in a live browser. They are the only evidence for technology
 * claims, they are written only here, and no analysis import ever changes them.
 */
export function MotionNotes({ study }: { readonly study: MotionStudy }) {
  const update = useMotionStudyUpdate(study.referenceId);
  const [notes, setNotes] = useState(study.inspectionNotes ?? "");
  const [tech, setTech] = useState<VerifiedTechEntry[]>(study.verifiedTech);
  const notesId = useId();

  // A fresh read replaces the draft only when nothing is being edited.
  const dirty = notes !== (study.inspectionNotes ?? "") || JSON.stringify(tech) !== JSON.stringify(study.verifiedTech);
  useEffect(() => {
    if (!update.isPending) {
      setNotes(study.inspectionNotes ?? "");
      setTech(study.verifiedTech);
    }
    // Keyed on the stored revision only: typing must not be overwritten by re-renders.
  }, [study.updatedAt]);

  const valid = tech.every((entry) => entry.claim.trim().length > 0 && entry.source.trim().length > 0);

  return (
    <section className={styles.notes} aria-labelledby={`${notesId}-head`}>
      <MonoLabel id={`${notesId}-head`} size="small" uppercase className={styles.sectionHead}>
        Inspection notes & verified tech
      </MonoLabel>
      <label htmlFor={notesId} className="rv-visually-hidden">Inspection notes</label>
      <textarea
        id={notesId}
        className={styles.notesInput}
        rows={3}
        value={notes}
        placeholder="What you saw and checked in a live browser: how it responded to the cursor, what kept moving, anything the recording misses."
        onChange={(event) => setNotes(event.target.value)}
      />

      <ol className={styles.techList}>
        {tech.map((entry, index) => (
          <li key={index} className={styles.techRow}>
            <MonoLabel size="micro" tone="muted" className={styles.techIndex}>{String(index).padStart(2, "0")}</MonoLabel>
            <input
              className={styles.techInput}
              aria-label={`Verified claim ${index}`}
              value={entry.claim}
              placeholder="window.gsap and ScrollTrigger defined"
              onChange={(event) => setTech(tech.map((row, at) => (at === index ? { ...row, claim: event.target.value } : row)))}
            />
            <input
              className={styles.techInput}
              aria-label={`Source of claim ${index}`}
              value={entry.source}
              placeholder="DevTools console"
              onChange={(event) => setTech(tech.map((row, at) => (at === index ? { ...row, source: event.target.value } : row)))}
            />
            <ActionButton variant="quiet" size="small" onClick={() => setTech(tech.filter((_, at) => at !== index))}>
              Remove
            </ActionButton>
          </li>
        ))}
      </ol>

      <div className={styles.notesActions}>
        <ActionButton variant="outline" size="small" onClick={() => setTech([...tech, { claim: "", source: "" }])} disabled={tech.length >= 40}>
          Add verified tech
        </ActionButton>
        <ActionButton
          variant="solid"
          size="small"
          disabled={!dirty || !valid || update.isPending}
          onClick={() => update.mutate({
            inspectionNotes: notes.trim() === "" ? null : notes.trim(),
            verifiedTech: tech.map((entry) => ({ claim: entry.claim.trim(), source: entry.source.trim() })),
          })}
        >
          {update.isPending ? "Saving" : "Save notes"}
        </ActionButton>
        <MonoLabel size="micro" tone="muted" uppercase>
          {!valid ? "Every entry needs a claim and a source" : dirty ? "Unsaved changes" : "Never changed by an import"}
        </MonoLabel>
      </div>
      {update.isError ? (
        <p role="alert" className={styles.inlineError}>{describeIngestFailure(update.error, "update").detail}</p>
      ) : null}
    </section>
  );
}
