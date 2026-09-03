import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReferenceResponse } from "@retr0vault/shared";

import {
  ActionButton,
  CopyActionButton,
  MonoLabel,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { useDeleteReference } from "@/lib/references/useDeleteReference";

import styles from "./ReferenceModal.module.css";

export interface ReferenceActionsProps {
  /** Absent while the sheet is loading, or when the read failed. */
  readonly reference: ReferenceResponse | undefined;
  readonly onClose: () => void;
  /** Called once the archive no longer holds the reference. */
  readonly onDeleted: () => void;
}

function describeDeleteFailure(error: unknown): string {
  if (error instanceof ApiError && error.isOffline) {
    return "The local API is not answering, so nothing was removed. Start it with npm run dev:api and try again.";
  }
  if (error instanceof ApiError) {
    return `The archive refused the removal: ${error.message}`;
  }
  return "Something failed between the browser and the local API, and nothing was removed.";
}

/**
 * The sheet's action row, and the only place a reference can be withdrawn from
 * the archive.
 *
 *   COPY BRIEF   COPY IMAGE RECIPE   DELETE REFERENCE   CLOSE
 *
 * DELETE REFERENCE never deletes. It replaces the row with a question and two
 * answers, in the same strip, at the same size — no second dialog over the
 * first, no warning panel, no borrowed danger colour:
 *
 *   REMOVE THIS REFERENCE?   CANCEL   DELETE
 *
 * Only that second DELETE reaches the backend.
 */
export function ReferenceActions({
  reference,
  onClose,
  onDeleted,
}: ReferenceActionsProps) {
  const [confirming, setConfirming] = useState(false);
  const promptId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const remove = useDeleteReference();

  /*
   * The sheet is a route, so it can be unmounted out from under an in-flight
   * removal by Escape or by Back. The request still completes and the caches
   * are still settled; only the navigation that follows is dropped, since
   * there is no longer a sheet to close.
   */
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /*
   * Focus goes to CANCEL rather than DELETE. The question has just appeared
   * under the reader's hands, and the whole point of asking it is that a
   * reflexive Enter must not remove anything.
   */
  useEffect(() => {
    if (confirming) {
      cancel.current?.focus();
    }
  }, [confirming]);

  const confirm = useCallback(() => {
    if (reference === undefined || remove.isPending) {
      return;
    }
    remove.mutate(reference.id, {
      onSuccess: () => {
        if (mounted.current) {
          onDeleted();
        }
      },
    });
  }, [onDeleted, reference, remove]);

  const brief = reference?.designBrief?.trim() ?? "";
  const recipe = reference?.imageRecipe?.trim() ?? "";

  if (confirming && reference !== undefined) {
    return (
      <>
        <div
          role="group"
          aria-labelledby={promptId}
          className={styles.confirmRow}
        >
          <MonoLabel
            id={promptId}
            size="small"
            uppercase
            marker="hollow"
            className={styles.confirmPrompt}
          >
            Remove this reference?
          </MonoLabel>

          <ActionButton
            ref={cancel}
            variant="outline"
            disabled={remove.isPending}
            onClick={() => {
              remove.reset();
              setConfirming(false);
            }}
          >
            Cancel
          </ActionButton>

          <ActionButton
            variant="accent"
            disabled={remove.isPending}
            aria-busy={remove.isPending}
            onClick={confirm}
          >
            {remove.isPending ? "Deleting…" : "Delete"}
          </ActionButton>
        </div>

        {/*
          * The removal's own progress and outcome, announced rather than only
          * printed: the label that changed is inside a disabled control, which
          * a screen reader has no reason to re-read on its own.
          */}
        <span className="rv-visually-hidden" role="status">
          {remove.isPending ? "Removing this reference from the archive" : ""}
        </span>

        {remove.isError ? (
          <p role="alert" className={styles.deleteError}>
            {describeDeleteFailure(remove.error)}
          </p>
        ) : null}
      </>
    );
  }

  /*
   * CLOSE is rendered outside the conditional, in the position it has always
   * held, so that it is the same DOM node before and after the reference
   * finishes loading. Wrapping it in the branch instead would have React
   * discard and rebuild it the moment the read resolves — and a press already
   * on its way down would land on a node no longer in the document.
   */
  return (
    <>
      {reference === undefined ? null : (
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
          <ActionButton
            variant="remove"
            title="Permanently remove this reference from the archive"
            onClick={() => setConfirming(true)}
          >
            Delete reference
          </ActionButton>
        </>
      )}
      <ActionButton variant="outline" onClick={onClose}>
        Close
      </ActionButton>
    </>
  );
}
