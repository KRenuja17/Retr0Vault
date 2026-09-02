import { useState } from "react";
import type { ReferenceResponse } from "@retr0vault/shared";

import { ActionButton, MonoLabel } from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { useCollections } from "@/lib/catalogue/useCatalogue";
import { useCollectionMembership } from "@/lib/collections/useCollectionActions";
import { cx } from "@/lib/cx";

import styles from "./ReferenceModal.module.css";

export interface CollectionMembershipProps {
  readonly reference: ReferenceResponse;
}

/**
 * Collection membership for the open reference: a ruled list, one line per
 * collection, with a single word at the end of each rule. No dropdown, no
 * popover, no checkbox cards — the sheet stays a specimen sheet.
 */
export function CollectionMembership({ reference }: CollectionMembershipProps) {
  const collections = useCollections();
  const membership = useCollectionMembership();
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const items = collections.data ?? [];
  const member = new Set(reference.collectionIds);

  function toggle(collectionId: string, name: string, nextMember: boolean) {
    if (pending !== null) return;
    setFailure(null);
    setPending(collectionId);

    membership.mutate(
      { collectionId, referenceId: reference.id, member: nextMember },
      {
        onError: (error) => {
          setFailure(
            error instanceof ApiError && error.isOffline
              ? "The local API is not answering, so nothing was changed."
              : error instanceof ApiError
                ? error.message
                : `${name} could not be changed.`,
          );
        },
        onSettled: () => setPending(null),
      },
    );
  }

  return (
    <div className={styles.collections}>
      <MonoLabel size="small" uppercase className={styles.collectionsHead}>
        Collections
      </MonoLabel>

      {collections.isPending ? (
        <MonoLabel size="small" tone="muted" uppercase className={styles.absent}>
          Reading collections
        </MonoLabel>
      ) : collections.isError ? (
        <MonoLabel size="small" tone="muted" uppercase marker="hollow" className={styles.absent}>
          Collections could not be read
        </MonoLabel>
      ) : items.length === 0 ? (
        <MonoLabel size="small" tone="muted" uppercase className={styles.absent}>
          No collections exist yet
        </MonoLabel>
      ) : (
        <ul className={styles.collectionList} aria-label="Collection membership">
          {items.map((collection) => {
            const isMember = member.has(collection.id);
            const inFlight = pending === collection.id;

            return (
              <li key={collection.id} className={styles.collectionRow}>
                <MonoLabel
                  size="small"
                  tone={isMember ? "ink" : "muted"}
                  marker={isMember ? "solid" : "hollow"}
                  className={cx(isMember && styles.collectionMember)}
                >
                  {collection.name}
                </MonoLabel>
                <MonoLabel size="micro" tone="muted" uppercase>
                  {`${collection.referenceCount}`}
                </MonoLabel>
                <ActionButton
                  variant={isMember ? "quiet" : "outline"}
                  size="small"
                  disabled={pending !== null}
                  onClick={() => toggle(collection.id, collection.name, !isMember)}
                  title={
                    isMember
                      ? `Remove this reference from ${collection.name}`
                      : `Add this reference to ${collection.name}`
                  }
                >
                  {inFlight ? "Saving" : isMember ? "Remove" : "Add"}
                </ActionButton>
              </li>
            );
          })}
        </ul>
      )}

      {failure === null ? null : (
        <MonoLabel size="micro" className={styles.collectionsError} role="alert">
          {failure}
        </MonoLabel>
      )}
    </div>
  );
}
