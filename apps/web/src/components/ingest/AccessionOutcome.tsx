import type { ReferenceResponse } from "@retr0vault/shared";

import { ActionButton, ActionLink, MonoLabel } from "@/components/primitives";
import { describeIngestFailure, type IngestSubject } from "@/lib/ingest/errors";
import { cx } from "@/lib/cx";

import styles from "./Ingest.module.css";

export interface AccessionOutcomeProps {
  readonly subject: IngestSubject;
  /** The reference the API returned, once one exists. */
  readonly reference: ReferenceResponse | undefined;
  /** Whatever the mutation rejected with; undefined while it has not failed. */
  readonly error: unknown;
  readonly onDismiss: () => void;
}

/**
 * What happened to the last submission, printed in place under the form. The
 * archive has no toasts: an outcome stays on the page until it is dismissed or
 * replaced by the next one.
 */
export function AccessionOutcome({
  subject,
  reference,
  error,
  onDismiss,
}: AccessionOutcomeProps) {
  if (error !== undefined) {
    const failure = describeIngestFailure(error, subject);

    return (
      <div className={cx(styles.notice, styles.noticeFailure)} role="alert">
        <MonoLabel size="small" uppercase marker="hollow" className={styles.statusFailed}>
          Not filed
        </MonoLabel>
        <p className={styles.noticeTitle}>{failure.headline}</p>
        <p className={styles.noticeBody}>{failure.detail}</p>
        {failure.hint === undefined ? null : (
          <MonoLabel size="small" tone="soft">
            {failure.hint}
          </MonoLabel>
        )}
        {failure.signature === undefined ? null : (
          <MonoLabel size="micro" tone="muted">
            {failure.signature}
          </MonoLabel>
        )}
        <div className={styles.noticeLinks}>
          <ActionButton variant="outline" size="small" onClick={onDismiss}>
            Dismiss
          </ActionButton>
        </div>
      </div>
    );
  }

  if (reference === undefined) return null;

  return (
    <div className={styles.notice} role="status">
      <MonoLabel size="small" uppercase marker="hollow" className={styles.statusPending}>
        Awaiting analysis
      </MonoLabel>
      <p className={styles.noticeTitle}>{reference.title}</p>
      <p className={styles.noticeBody}>
        Filed in the archive as plate{" "}
        {reference.sourceType === "website" ? "capture" : "image"}. It appears in
        the catalogue now and carries no vocabulary until an analysis is
        imported for it.
      </p>
      <div className={styles.noticeLinks}>
        <ActionLink variant="outline" size="small" to={`/reference/${reference.id}`}>
          Open the plate
        </ActionLink>
        <ActionLink variant="quiet" size="small" to="/all">
          View the archive
        </ActionLink>
        <ActionButton variant="quiet" size="small" onClick={onDismiss}>
          Dismiss
        </ActionButton>
      </div>
    </div>
  );
}
