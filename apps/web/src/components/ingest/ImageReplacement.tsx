import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import type { ReferenceResponse } from "@retr0vault/shared";

import { ActionButton, ActionLink, EditorialHeading, MonoLabel } from "@/components/primitives";
import { referenceThumbnailUrl } from "@/lib/api/media";
import { cx } from "@/lib/cx";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { useImageReplacement } from "@/lib/ingest/useIngest";
import { formatBytes, IMAGE_ACCEPT_ATTRIBUTE, MAX_UPLOAD_BYTES, validateImageFile } from "@/lib/ingest/validation";

import { CheckField } from "./Field";
import { ReferencePicker } from "./ReferencePicker";
import styles from "./Ingest.module.css";
import pair from "./ImageReplacement.module.css";

interface SelectedImage {
  readonly file: File;
  readonly previewUrl: string;
}

function describePicture(reference: ReferenceResponse): string {
  const { width, height, format } = reference.image;
  return [
    reference.sourceType === "website" ? "Website capture" : "Image plate",
    `${width} × ${height}`,
    format.toUpperCase(),
  ].join(" · ");
}

/**
 * The replacement lane: choose a reference already in the archive and mount a
 * new picture for it. Only the picture changes: the title, analysis, tags,
 * collections and motion study all stay with the reference. A website capture
 * takes the new picture as its primary viewport frame; its hero and scroll
 * frames stay as they were captured.
 */
export function ImageReplacement() {
  const replacement = useImageReplacement();
  const [reference, setReference] = useState<ReferenceResponse | null>(null);
  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dimensions, setDimensions] = useState<string | null>(null);
  const [resetAnalysis, setResetAnalysis] = useState(false);
  const [replaced, setReplaced] = useState<ReferenceResponse | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const headingId = useId();
  const previewUrl = useRef<string | null>(null);

  const { reset: resetReplacement } = replacement;

  const revoke = useCallback(() => {
    if (previewUrl.current !== null) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
  }, []);

  useEffect(() => revoke, [revoke]);

  const clear = useCallback(() => {
    revoke();
    setSelected(null);
    setDimensions(null);
    setRejection(null);
    if (fileInput.current !== null) fileInput.current.value = "";
  }, [revoke]);

  const select = useCallback((file: File | undefined) => {
    resetReplacement();
    setReplaced(null);
    setDimensions(null);
    if (file === undefined) return;

    const problem = validateImageFile(file);
    revoke();
    if (problem !== null) {
      setRejection(problem);
      setSelected(null);
      return;
    }
    setRejection(null);
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
    previewUrl.current = url === "" ? null : url;
    setSelected({ file, previewUrl: url });
  }, [resetReplacement, revoke]);

  function choose(next: ReferenceResponse | null) {
    resetReplacement();
    setReference(next);
    setReplaced(null);
    setResetAnalysis(false);
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (replacement.isPending) return;
    const files = event.dataTransfer?.files;
    if (files !== undefined && files.length > 1) {
      setRejection("Drop one image at a time; a reference holds a single picture.");
      return;
    }
    select(files?.[0]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (reference === null || selected === null || replacement.isPending) return;
    replacement.mutate(
      { referenceId: reference.id, file: selected.file, resetAnalysis },
      {
        onSuccess: (updated) => {
          setReference(updated);
          setReplaced(updated);
          setResetAnalysis(false);
          clear();
        },
      },
    );
  }

  const failure = replacement.isError ? describeIngestFailure(replacement.error, "replace") : null;
  const analysed = reference !== null && reference.analysisStatus !== "pending";

  return (
    <section id="replace" className={styles.lane} aria-labelledby={headingId}>
      <header className={styles.laneHead}>
        <MonoLabel size="small" uppercase marker="square">Replacement</MonoLabel>
        <EditorialHeading level={2} scale="section" id={headingId}>Replace a reference's picture</EditorialHeading>
        <p className={styles.laneNote}>
          A new screenshot or image for a reference you already hold: JPEG, PNG or WebP up to {formatBytes(MAX_UPLOAD_BYTES)}.
          Only the picture and its thumbnail change; the title, analysis, tags, collections and motion study stay.
          A website capture takes it as its primary viewport, and keeps its other captured frames.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <ReferencePicker
          lane="replace"
          selected={reference}
          onSelect={choose}
          chosenLabel="Replacing the picture of"
          searchLabel="Find the reference whose picture to replace"
          describeChosen={describePicture}
          describeItem={(item) => item.sourceUrl ?? item.sourceType}
          empty="No reference matches. File the plate or capture the site above first."
        />

        <div
          role="group"
          aria-label="Replacement mount"
          className={cx(styles.specimen, dragging && styles.specimenActive)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <div className={pair.pair}>
            <figure className={styles.preview}>
              {reference === null ? (
                <div className={pair.pairEmpty}>
                  <MonoLabel size="small" tone="soft" uppercase marker="hollow">No reference chosen</MonoLabel>
                </div>
              ) : (
                <img
                  className={pair.pairImage}
                  src={referenceThumbnailUrl(reference.id, reference.updatedAt)}
                  alt={`Current picture of ${reference.title}`}
                  draggable={false}
                />
              )}
              <figcaption className={styles.previewMeta}>
                <MonoLabel size="micro" tone="muted" uppercase>Now</MonoLabel>
                {reference === null ? null : (
                  <MonoLabel size="micro" tone="muted">{`${reference.image.width} × ${reference.image.height}`}</MonoLabel>
                )}
              </figcaption>
            </figure>

            <figure className={styles.preview}>
              {selected === null ? (
                <div className={pair.pairEmpty}>
                  <MonoLabel size="small" tone="soft" uppercase marker="hollow">
                    {dragging ? "Release to mount" : "Drop the new picture here"}
                  </MonoLabel>
                  <MonoLabel size="micro" tone="muted" uppercase>or choose a file below</MonoLabel>
                </div>
              ) : selected.previewUrl === "" ? (
                <div className={pair.pairEmpty}>
                  <MonoLabel size="small" tone="muted" uppercase marker="hollow">Preview unavailable in this browser</MonoLabel>
                </div>
              ) : (
                <img
                  className={pair.pairImage}
                  src={selected.previewUrl}
                  alt={`Preview of ${selected.file.name}`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0) setDimensions(`${image.naturalWidth} × ${image.naturalHeight}`);
                  }}
                />
              )}
              <figcaption className={styles.previewMeta}>
                <MonoLabel size="micro" tone="muted" uppercase>Replacement</MonoLabel>
                {selected === null ? null : (
                  <MonoLabel size="micro" tone="muted">
                    {[selected.file.name, dimensions, formatBytes(selected.file.size)].filter(Boolean).join(" · ")}
                  </MonoLabel>
                )}
              </figcaption>
            </figure>
          </div>

          <div className={styles.specimenActions}>
            <input
              ref={fileInput}
              id={fileInputId}
              className={styles.fileInput}
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              disabled={replacement.isPending}
              onChange={(event) => select(event.target.files?.[0])}
            />
            <label className={styles.picker} htmlFor={fileInputId}>
              {selected === null ? "Choose new picture" : "Choose another picture"}
            </label>
            {selected === null ? null : (
              <ActionButton variant="quiet" size="small" onClick={clear} disabled={replacement.isPending}>Remove</ActionButton>
            )}
          </div>
        </div>

        {rejection === null ? null : (
          <MonoLabel size="small" className={styles.fieldError} role="alert">{rejection}</MonoLabel>
        )}

        {analysed ? (
          <CheckField
            label="File for re-analysis"
            checked={resetAnalysis}
            onChange={setResetAnalysis}
            disabled={replacement.isPending}
            hint="The design analysis was written about the old picture. Checked, the reference returns to the pending manifest; its fields stay until a new analysis is imported."
          />
        ) : null}

        <div className={styles.actions}>
          <ActionButton type="submit" variant="solid" disabled={reference === null || selected === null || replacement.isPending}>
            {replacement.isPending ? "Replacing" : "Replace the picture"}
          </ActionButton>
          <MonoLabel size="micro" tone="muted" uppercase className={styles.actionsNote}>
            {reference === null
              ? "Choose a reference first"
              : selected === null
                ? "No picture mounted"
                : replacement.isPending
                  ? "Storing and thumbnailing"
                  : "The old picture is removed"}
          </MonoLabel>
        </div>
      </form>

      {failure !== null ? (
        <div className={cx(styles.notice, styles.noticeFailure)} role="alert">
          <MonoLabel size="small" uppercase marker="hollow" className={styles.statusFailed}>Not replaced</MonoLabel>
          <p className={styles.noticeTitle}>{failure.headline}</p>
          <p className={styles.noticeBody}>{failure.detail}</p>
          {failure.hint === undefined ? null : <MonoLabel size="small" tone="soft">{failure.hint}</MonoLabel>}
          {failure.signature === undefined ? null : <MonoLabel size="micro" tone="muted">{failure.signature}</MonoLabel>}
          <div className={styles.noticeLinks}>
            <ActionButton variant="outline" size="small" onClick={() => replacement.reset()}>Dismiss</ActionButton>
          </div>
        </div>
      ) : replaced !== null ? (
        <div className={styles.notice} role="status">
          <MonoLabel size="small" uppercase marker="hollow" className={styles.statusPending}>
            {replaced.analysisStatus === "pending" ? "Replaced · awaiting analysis" : "Replaced"}
          </MonoLabel>
          <p className={styles.noticeTitle}>{replaced.title}</p>
          <p className={styles.noticeBody}>
            {`The new picture is filed: ${describePicture(replaced)}. The catalogue plate and detail sheet show it now.`}
          </p>
          <div className={styles.noticeLinks}>
            <ActionLink variant="outline" size="small" to={`/reference/${replaced.id}`}>Open the plate</ActionLink>
            <ActionLink variant="quiet" size="small" to="/all">View the archive</ActionLink>
            <ActionButton variant="quiet" size="small" onClick={() => setReplaced(null)}>Dismiss</ActionButton>
          </div>
        </div>
      ) : null}
    </section>
  );
}
