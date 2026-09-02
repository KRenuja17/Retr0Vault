import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";

import {
  ActionButton,
  EditorialHeading,
  MonoLabel,
} from "@/components/primitives";
import { useDesignTypes } from "@/lib/catalogue/useCatalogue";
import { useImageAccession } from "@/lib/ingest/useIngest";
import {
  formatBytes,
  IMAGE_ACCEPT_ATTRIBUTE,
  MAX_UPLOAD_BYTES,
  validateImageFile,
  validateSourceUrl,
} from "@/lib/ingest/validation";
import { cx } from "@/lib/cx";

import { AccessionOutcome } from "./AccessionOutcome";
import { SelectField, TextField } from "./Field";
import styles from "./Ingest.module.css";

interface SelectedImage {
  readonly file: File;
  readonly previewUrl: string;
}

/**
 * The image lane: drop a plate onto the specimen mount or choose one, add the
 * marginalia the archive cannot infer, and file it. The reference is stored
 * immediately and filed as awaiting analysis; nothing is sent anywhere else.
 */
export function ImageAccession() {
  const designTypes = useDesignTypes();
  const accession = useImageAccession();

  const [selected, setSelected] = useState<SelectedImage | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceUrlError, setSourceUrlError] = useState<string | null>(null);
  const [designTypeId, setDesignTypeId] = useState("");
  const [dimensions, setDimensions] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);
  const fileInputId = useId();
  const headingId = useId();
  // The preview URL is revoked when it is replaced and when the lane unmounts;
  // holding it in a ref keeps the unmount cleanup out of the selection effect.
  const previewUrl = useRef<string | null>(null);

  // `reset` is stable across renders; the mutation object itself is not.
  const { reset: resetAccession } = accession;

  const select = useCallback((file: File | undefined) => {
    resetAccession();
    setDimensions(null);

    if (file === undefined) return;

    const problem = validateImageFile(file);
    if (problem !== null) {
      setRejection(problem);
      setSelected(null);
      if (previewUrl.current !== null) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
      return;
    }

    setRejection(null);
    if (previewUrl.current !== null) {
      URL.revokeObjectURL(previewUrl.current);
    }
    /*
     * jsdom and any browser without object URLs still get a working form; only
     * the visual preview is lost, so the empty string is rendered as "no
     * preview available" rather than as a broken image.
     */
    const url =
      typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
    previewUrl.current = url === "" ? null : url;
    setSelected({ file, previewUrl: url });
  }, [resetAccession]);

  useEffect(
    () => () => {
      if (previewUrl.current !== null) {
        URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = null;
      }
    },
    [],
  );

  const clear = useCallback(() => {
    if (previewUrl.current !== null) {
      URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = null;
    }
    setSelected(null);
    setDimensions(null);
    setRejection(null);
    if (fileInput.current !== null) {
      fileInput.current.value = "";
    }
  }, []);

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    // A drop bypasses the disabled file input, so the upload guards itself.
    if (accession.isPending) return;

    const files = event.dataTransfer?.files;
    if (files !== undefined && files.length > 1) {
      setRejection("Drop one image at a time; a plate holds a single reference.");
      return;
    }
    select(files?.[0]);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second submit while the first is in flight would file the plate twice.
    if (selected === null || accession.isPending) return;

    const urlProblem = validateSourceUrl(sourceUrl);
    setSourceUrlError(urlProblem);
    if (urlProblem !== null) return;

    accession.mutate(
      {
        file: selected.file,
        title: title.trim() === "" ? undefined : title.trim(),
        sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
        designTypeId: designTypeId === "" ? undefined : designTypeId,
      },
      {
        onSuccess: () => {
          clear();
          setTitle("");
          setSourceUrl("");
          setDesignTypeId("");
        },
      },
    );
  }

  const designTypeOptions = (designTypes.data ?? []).map((designType) => ({
    value: designType.id,
    label: designType.name,
  }));

  return (
    <section className={styles.lane} aria-labelledby={headingId}>
      <header className={styles.laneHead}>
        <MonoLabel size="small" uppercase marker="square">
          Image plate
        </MonoLabel>
        <EditorialHeading level={2} scale="section" id={headingId}>
          File an image reference
        </EditorialHeading>
        <p className={styles.laneNote}>
          JPEG, PNG or WebP up to {formatBytes(MAX_UPLOAD_BYTES)}. The file is
          copied into local storage and thumbnailed; the original is never
          altered.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {/*
          * A labelled group rather than a bare div: the mount, its preview and
          * its file control are one thing, and it can be named in speech.
          */}
        <div
          role="group"
          aria-label="Image plate mount"
          className={cx(styles.specimen, dragging && styles.specimenActive)}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          {selected === null ? (
            <div className={styles.specimenLegend}>
              <MonoLabel size="small" tone="soft" uppercase marker="hollow">
                {dragging ? "Release to mount" : "Drop a plate here"}
              </MonoLabel>
              <MonoLabel size="micro" tone="muted" uppercase>
                or choose a file below
              </MonoLabel>
            </div>
          ) : (
            <figure className={styles.preview}>
              {selected.previewUrl === "" ? (
                <MonoLabel size="small" tone="muted" uppercase marker="hollow">
                  Preview unavailable in this browser
                </MonoLabel>
              ) : (
                <img
                  className={styles.previewImage}
                  src={selected.previewUrl}
                  alt={`Preview of ${selected.file.name}`}
                  onLoad={(event) => {
                    const image = event.currentTarget;
                    if (image.naturalWidth > 0) {
                      setDimensions(
                        `${image.naturalWidth} × ${image.naturalHeight}`,
                      );
                    }
                  }}
                />
              )}
              <figcaption className={styles.previewMeta}>
                <MonoLabel size="small" tone="soft">
                  {selected.file.name}
                </MonoLabel>
                <MonoLabel size="micro" tone="muted" uppercase>
                  {[dimensions, formatBytes(selected.file.size)]
                    .filter((part): part is string => part !== null)
                    .join(" · ")}
                </MonoLabel>
              </figcaption>
            </figure>
          )}

          <div className={styles.specimenActions}>
            {/*
              * The input carries the accessible name and the tab stop; the
              * label beside it is the visible control, and takes the focus ring
              * from the input through the CSS sibling rule.
              */}
            <input
              ref={fileInput}
              id={fileInputId}
              className={styles.fileInput}
              type="file"
              accept={IMAGE_ACCEPT_ATTRIBUTE}
              disabled={accession.isPending}
              onChange={(event) => select(event.target.files?.[0])}
            />
            <label className={styles.picker} htmlFor={fileInputId}>
              {selected === null ? "Choose image file" : "Replace image"}
            </label>
            {selected === null ? null : (
              <ActionButton
                variant="quiet"
                size="small"
                onClick={clear}
                disabled={accession.isPending}
              >
                Remove
              </ActionButton>
            )}
          </div>
        </div>

        {rejection === null ? null : (
          <MonoLabel size="small" className={styles.fieldError} role="alert">
            {rejection}
          </MonoLabel>
        )}

        <div className={styles.formGrid}>
          <TextField
            label="Title"
            note="Optional"
            value={title}
            onChange={setTitle}
            placeholder="Untitled Reference"
            disabled={accession.isPending}
            hint="Left blank, the archive files it as Untitled Reference."
          />
          <TextField
            label="Source"
            note="Optional"
            type="url"
            value={sourceUrl}
            onChange={(value) => {
              setSourceUrl(value);
              setSourceUrlError(null);
            }}
            placeholder="https://"
            disabled={accession.isPending}
            error={sourceUrlError ?? undefined}
            hint="Where the reference came from. Never fetched."
          />
          <SelectField
            className={styles.formGridWide}
            label="Design type"
            note="Optional"
            value={designTypeId}
            onChange={setDesignTypeId}
            options={designTypeOptions}
            placeholderOption="Unassigned — set by analysis"
            disabled={accession.isPending || designTypes.isPending}
            hint={
              designTypes.isError
                ? "Design types could not be read; the plate can still be filed unassigned."
                : "An imported analysis may reassign this."
            }
          />
        </div>

        <div className={styles.actions}>
          <ActionButton
            type="submit"
            variant="solid"
            disabled={selected === null || accession.isPending}
          >
            {accession.isPending ? "Filing" : "File this plate"}
          </ActionButton>
          <MonoLabel size="micro" tone="muted" uppercase className={styles.actionsNote}>
            {selected === null
              ? "No plate mounted"
              : accession.isPending
                ? "Storing and thumbnailing"
                : "Files as awaiting analysis"}
          </MonoLabel>
        </div>
      </form>

      <AccessionOutcome
        subject="upload"
        reference={accession.data}
        error={accession.isError ? accession.error : undefined}
        onDismiss={() => accession.reset()}
      />
    </section>
  );
}
