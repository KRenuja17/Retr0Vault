import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  AnalysisStatus,
  ReferenceResponse,
  UpdateReferenceInput,
} from "@retr0vault/shared";

import {
  ActionButton,
  ModalSurface,
  ModalTitle,
  MonoLabel,
} from "@/components/primitives";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { useDesignTypes } from "@/lib/catalogue/useCatalogue";
import { useMetadataUpdate } from "@/lib/ingest/useIngest";
import { formatVocabulary, parseVocabulary } from "@/lib/ingest/vocabulary";
import { cx } from "@/lib/cx";

import { SelectField, TextAreaField, TextField } from "./Field";
import styles from "./Ingest.module.css";

const STATUS_OPTIONS: ReadonlyArray<{ value: AnalysisStatus; label: string }> = [
  { value: "pending", label: "Pending — awaiting analysis" },
  { value: "analyzed", label: "Analyzed — metadata present" },
  { value: "manual", label: "Manual — locked against imports" },
  { value: "failed", label: "Failed — analysis could not be produced" },
];

interface Draft {
  title: string;
  designTypeId: string;
  designDNA: string;
  designThesis: string;
  designBrief: string;
  imageRecipe: string;
  vocabulary: string;
  analysisStatus: AnalysisStatus;
}

function draftFrom(reference: ReferenceResponse): Draft {
  return {
    title: reference.title,
    designTypeId: reference.designTypeId ?? "",
    designDNA: reference.designDNA ?? "",
    designThesis: reference.designThesis ?? "",
    designBrief: reference.designBrief ?? "",
    imageRecipe: reference.imageRecipe ?? "",
    vocabulary: formatVocabulary(reference.tags),
    analysisStatus: reference.analysisStatus,
  };
}

/** Empty clears the field; the backend stores null rather than an empty string. */
function textPatch(next: string, previous: string): string | null | undefined {
  const trimmed = next.trim();
  if (trimmed === previous.trim()) return undefined;
  return trimmed === "" ? null : trimmed;
}

export interface MetadataEditorProps {
  readonly reference: ReferenceResponse;
  readonly onClose: () => void;
  readonly onSaved: (reference: ReferenceResponse) => void;
}

/**
 * Manual metadata editing for one reference, over the analysis desk.
 *
 * Every field written here is marked protected by the backend, so a later
 * analysis import preserves it unless the curator explicitly overwrites
 * protected fields. That is the whole point of editing by hand.
 */
export function MetadataEditor({
  reference,
  onClose,
  onSaved,
}: MetadataEditorProps) {
  const designTypes = useDesignTypes();
  const update = useMetadataUpdate();
  const original = useMemo(() => draftFrom(reference), [reference]);
  const [draft, setDraft] = useState<Draft>(original);
  const [problem, setProblem] = useState<string | null>(null);
  const formId = useId();

  const set = <TKey extends keyof Draft>(key: TKey, value: Draft[TKey]) => {
    setProblem(null);
    setDraft((current) => ({ ...current, [key]: value }));
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (update.isPending) return;

    const title = draft.title.trim();
    if (title === "") {
      setProblem("A reference needs a title.");
      return;
    }

    const vocabulary = parseVocabulary(draft.vocabulary);
    if (vocabulary.error !== null) {
      setProblem(vocabulary.error);
      return;
    }

    const patch: UpdateReferenceInput = {};
    if (title !== original.title.trim()) patch.title = title;
    if (draft.designTypeId !== original.designTypeId) {
      patch.designTypeId = draft.designTypeId === "" ? null : draft.designTypeId;
    }

    const designDNA = textPatch(draft.designDNA, original.designDNA);
    if (designDNA !== undefined) patch.designDNA = designDNA;
    const designThesis = textPatch(draft.designThesis, original.designThesis);
    if (designThesis !== undefined) patch.designThesis = designThesis;
    const designBrief = textPatch(draft.designBrief, original.designBrief);
    if (designBrief !== undefined) patch.designBrief = designBrief;
    const imageRecipe = textPatch(draft.imageRecipe, original.imageRecipe);
    if (imageRecipe !== undefined) patch.imageRecipe = imageRecipe;

    if (draft.vocabulary.trim() !== original.vocabulary.trim()) {
      patch.tags = [...vocabulary.tags];
    }
    if (draft.analysisStatus !== original.analysisStatus) {
      patch.analysisStatus = draft.analysisStatus;
    }

    // The backend rejects an empty patch; say so here rather than as a 400.
    if (Object.keys(patch).length === 0) {
      setProblem("Nothing has changed yet.");
      return;
    }

    update.mutate(
      { referenceId: reference.id, patch },
      { onSuccess: (saved) => onSaved(saved) },
    );
  }

  const failure = update.isError
    ? describeIngestFailure(update.error, "update")
    : null;

  return (
    <ModalSurface
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      label={`Edit metadata for ${reference.title}`}
      size="wide"
      titleMode="provided"
      showCloseButton={false}
      footer={
        <>
          <ActionButton
            type="submit"
            form={formId}
            variant="solid"
            disabled={update.isPending}
          >
            {update.isPending ? "Saving" : "Save metadata"}
          </ActionButton>
          <ActionButton variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </ActionButton>
        </>
      }
    >
      <div className={styles.editor}>
        <div>
          <MonoLabel size="small" tone="muted" uppercase>
            Manual entry
          </MonoLabel>
          <ModalTitle className={styles.noticeTitle}>
            {reference.title}
          </ModalTitle>
        </div>
        <p className={styles.editorNote}>
          Fields edited here are marked protected. A later analysis import
          leaves them alone unless it is run with overwrite protected fields
          turned on.
        </p>

        <form id={formId} className={styles.editorGrid} onSubmit={onSubmit} noValidate>
          <TextField
            label="Title"
            note="Required"
            value={draft.title}
            onChange={(value) => set("title", value)}
            disabled={update.isPending}
          />
          <SelectField
            label="Design type"
            value={draft.designTypeId}
            onChange={(value) => set("designTypeId", value)}
            options={(designTypes.data ?? []).map((designType) => ({
              value: designType.id,
              label: designType.name,
            }))}
            placeholderOption="Unassigned"
            disabled={update.isPending || designTypes.isPending}
          />
          <TextField
            className={styles.editorWide}
            label="Design DNA"
            value={draft.designDNA}
            onChange={(value) => set("designDNA", value)}
            placeholder="warm editorial × print DNA"
            disabled={update.isPending}
          />
          <TextAreaField
            className={styles.editorWide}
            label="Design thesis"
            value={draft.designThesis}
            onChange={(value) => set("designThesis", value)}
            rows={3}
            disabled={update.isPending}
          />
          <TextAreaField
            className={styles.editorWide}
            label="Vocabulary"
            note="One per line"
            value={draft.vocabulary}
            onChange={(value) => set("vocabulary", value)}
            rows={5}
            mono
            disabled={update.isPending}
            hint="type: term — for example palette: bone white with ember accent"
          />
          <TextAreaField
            className={styles.editorWide}
            label="Design brief"
            value={draft.designBrief}
            onChange={(value) => set("designBrief", value)}
            rows={5}
            disabled={update.isPending}
          />
          <TextAreaField
            className={styles.editorWide}
            label="Image recipe"
            value={draft.imageRecipe}
            onChange={(value) => set("imageRecipe", value)}
            rows={5}
            mono
            disabled={update.isPending}
            hint="Provider-neutral. Use [SUBJECT] where the subject belongs."
          />
          <SelectField
            className={styles.editorWide}
            label="Analysis status"
            value={draft.analysisStatus}
            onChange={(value) => {
              // Narrowed against the option list rather than cast, so a stray
              // value from the DOM can never reach the update request.
              const chosen = STATUS_OPTIONS.find((option) => option.value === value);
              if (chosen !== undefined) set("analysisStatus", chosen.value);
            }}
            options={STATUS_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            disabled={update.isPending}
            hint="Manual locks every field on this reference against future imports."
          />
        </form>

        {problem === null ? null : (
          <MonoLabel size="small" className={styles.fieldError} role="alert">
            {problem}
          </MonoLabel>
        )}

        {failure === null ? null : (
          <div className={cx(styles.notice, styles.noticeFailure)} role="alert">
            <p className={styles.noticeTitle}>{failure.headline}</p>
            <p className={styles.noticeBody}>{failure.detail}</p>
            {failure.signature === undefined ? null : (
              <MonoLabel size="micro" tone="muted">
                {failure.signature}
              </MonoLabel>
            )}
          </div>
        )}
      </div>
    </ModalSurface>
  );
}
