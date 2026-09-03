import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ReferenceResponse } from "@retr0vault/shared";

import {
  ActionButton,
  CopyActionButton,
  EditorialHeading,
  ModalSurface,
  ModalTitle,
  MonoLabel,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { fetchReference } from "@/lib/api/endpoints";
import { referenceOriginalUrl } from "@/lib/api/media";
import { queryKeys } from "@/lib/api/queryKeys";
import { cx } from "@/lib/cx";

import { CollectionMembership } from "./CollectionMembership";
import styles from "./ReferenceModal.module.css";

export interface ReferenceModalProps {
  readonly referenceId: string;
  readonly onClose: () => void;
}

/*
 * Splits a recipe so the replaceable `[SUBJECT…]` token can be marked. The
 * split pattern is global and therefore stateful, so matching uses a separate
 * anchored pattern rather than re-testing with the same regex object.
 */
const SUBJECT_SPLIT = /(\[SUBJECT[^\]]*\])/gu;
const SUBJECT_TOKEN = /^\[SUBJECT[^\]]*\]$/u;

function RecipeText({ recipe }: { readonly recipe: string }) {
  return (
    <>
      {recipe.split(SUBJECT_SPLIT).map((part, index) =>
        SUBJECT_TOKEN.test(part) ? (
          <mark key={`${index}-${part}`} className={styles.subject}>
            {part}
          </mark>
        ) : (
          <Fragment key={`${index}-${part}`}>{part}</Fragment>
        ),
      )}
    </>
  );
}

/** The capture itself: the original, never the catalogue's thumbnail. */
function Capture({ reference }: { readonly reference: ReferenceResponse }) {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  return (
    <figure className={styles.frame}>
      <img
        className={cx(styles.capture, state === "ready" && styles.captureReady)}
        src={referenceOriginalUrl(reference.id)}
        alt={`${reference.title} reference capture`}
        decoding="async"
        draggable={false}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
      />
      {state === "failed" ? (
        <figcaption className={styles.captureState}>
          <MonoLabel size="small" tone="muted" uppercase marker="hollow">
            Image unavailable
          </MonoLabel>
        </figcaption>
      ) : null}
    </figure>
  );
}

function LoadingSheet() {
  return (
    <div aria-hidden="true">
      <div className={cx(styles.ghostLine, styles.ghostTitle)} />
      <div className={styles.ghostLine} />
      <div className={cx(styles.ghostLine, styles.ghostShort)} />
    </div>
  );
}

function describeFailure(error: unknown): {
  readonly title: string;
  readonly detail: string;
} {
  if (error instanceof ApiError && error.isOffline) {
    return {
      title: "The archive is not answering",
      detail:
        "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api.",
    };
  }
  /*
   * 404 is an id the archive does not hold; 400 is an id it could never hold,
   * since the only input this route takes is that id. Both are the same thing
   * to a reader who followed a stale or hand-edited link.
   */
  if (
    error instanceof ApiError &&
    (error.statusCode === 404 || error.statusCode === 400)
  ) {
    return {
      title: "No such reference",
      detail: "The archive holds no reference under that id.",
    };
  }
  if (error instanceof ApiError) {
    return { title: "That reference could not be read", detail: error.message };
  }
  return {
    title: "That reference could not be read",
    detail: "Something failed between the browser and the local API.",
  };
}

/**
 * The reference detail sheet, raised over a darkened catalogue.
 *
 *   [ capture ]
 *   Title                                         design DNA
 *   Design thesis
 *   [term] [term] [term] …
 *   IMAGE RECIPE
 *   ────────────────────────────────────────────
 *   COPY BRIEF   COPY IMAGE RECIPE   CLOSE
 *
 * Radix supplies the focus trap, focus return, Escape and scroll lock; there is
 * no corner close affordance, only the CLOSE in the action row.
 */
export function ReferenceModal({ referenceId, onClose }: ReferenceModalProps) {
  const reference = useQuery({
    queryKey: queryKeys.reference(referenceId),
    queryFn: ({ signal }) => fetchReference(referenceId, signal),
  });

  const data = reference.data;
  const isPending = data?.analysisStatus === "pending";
  const recipe = data?.imageRecipe?.trim() ?? "";
  const brief = data?.designBrief?.trim() ?? "";

  return (
    <ModalSurface
      open
      onOpenChange={(next) => {
        if (!next) {
          onClose();
        }
      }}
      label={data?.title ?? "Reference"}
      size="specimen"
      /* Once loaded the sheet shows its own title, so it supplies the dialog's
       * accessible name; before then the hidden label stands in. */
      titleMode={data ? "provided" : "hidden"}
      showCloseButton={false}
      {...(data ? { media: <Capture reference={data} /> } : {})}
      footer={
        <>
          {data ? (
            <>
              <CopyActionButton
                label="Copy brief"
                text={brief}
                variant="solid"
                title={
                  brief.length > 0
                    ? "Copy the design brief for this reference"
                    : "No design brief filed for this reference"
                }
              />
              <CopyActionButton
                label="Copy image recipe"
                text={recipe}
                variant="solid"
                title={
                  recipe.length > 0
                    ? "Copy the reusable image recipe"
                    : "No image recipe filed for this reference"
                }
              />
            </>
          ) : null}
          <ActionButton variant="outline" onClick={onClose}>
            Close
          </ActionButton>
        </>
      }
    >
      {reference.isPending ? (
        <LoadingSheet />
      ) : reference.isError ? (
        <div className={styles.state}>
          <EditorialHeading level={2} scale="section" marker>
            {describeFailure(reference.error).title}
          </EditorialHeading>
          <p className={styles.thesis}>{describeFailure(reference.error).detail}</p>
        </div>
      ) : data ? (
        <>
          <div className={styles.masthead}>
            <ModalTitle className={styles.title}>{data.title}</ModalTitle>

            {isPending ? (
              <MonoLabel size="small" uppercase marker="hollow" tone="soft">
                Awaiting analysis
              </MonoLabel>
            ) : data.designDNA ? (
              <span className={styles.dna}>{data.designDNA}</span>
            ) : null}
          </div>

          {data.designThesis ? (
            <p className={styles.thesis}>{data.designThesis}</p>
          ) : null}

          {data.tags.length > 0 ? (
            <VocabularyChipSet className={styles.vocabulary}>
              {data.tags.map((tag) => (
                <VocabularyChip key={tag.id} wrap title={`${tag.type}: ${tag.value}`}>
                  {tag.value}
                </VocabularyChip>
              ))}
            </VocabularyChipSet>
          ) : null}

          <div className={styles.recipe}>
            <MonoLabel size="small" uppercase className={styles.recipeHead}>
              Image recipe — fill [SUBJECT]
            </MonoLabel>
            {recipe.length > 0 ? (
              <div className={styles.recipeBody}>
                <RecipeText recipe={recipe} />
              </div>
            ) : (
              <MonoLabel size="small" tone="muted" uppercase className={styles.absent}>
                No image recipe filed
              </MonoLabel>
            )}
          </div>

          <CollectionMembership reference={data} />

          {data.frames.length > 1 ? (
            <div className={styles.marginalia}>
              {/* The API serves one image per reference, so the other captured
                * frames are recorded but not individually retrievable. */}
              <MonoLabel size="micro" tone="muted" uppercase>
                {`${data.frames.length} frames captured · primary viewport shown`}
              </MonoLabel>
            </div>
          ) : null}
        </>
      ) : null}
    </ModalSurface>
  );
}
