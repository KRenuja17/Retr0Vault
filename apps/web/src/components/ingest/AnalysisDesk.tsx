import { useCallback, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { AnalysisStatus, ReferenceResponse } from "@retr0vault/shared";

import {
  ActionButton,
  ActionLink,
  EditorialHeading,
  MonoLabel,
  PageRule,
  padCount,
} from "@/components/primitives";
import { describeIngestFailure } from "@/lib/ingest/errors";
import {
  downloadJson,
  MAX_ANALYSES_PER_IMPORT,
  readAnalysisFiles,
  type AnalysisEntry,
} from "@/lib/ingest/analysisFiles";
import {
  useAccessionLedger,
  useAnalysisImport,
  useAnalysisReset,
  useArchiveInvalidation,
  usePendingManifest,
  useStatusCount,
} from "@/lib/ingest/useIngest";
import { useStats } from "@/lib/catalogue/useCatalogue";
import { cx } from "@/lib/cx";

import { CheckField } from "./Field";
import { MetadataEditor } from "./MetadataEditor";
import styles from "./Ingest.module.css";

const STATUS_LABEL: Record<AnalysisStatus, string> = {
  pending: "Awaiting analysis",
  analyzed: "Analyzed",
  manual: "Manual",
  failed: "Analysis failed",
};

function StatusMark({ status }: { readonly status: AnalysisStatus }) {
  return (
    <MonoLabel
      size="small"
      uppercase
      marker={status === "pending" ? "hollow" : status === "failed" ? "square" : "solid"}
      tone={status === "analyzed" || status === "manual" ? "soft" : "ink"}
      className={cx(
        status === "pending" && styles.statusPending,
        status === "failed" && styles.statusFailed,
      )}
    >
      {STATUS_LABEL[status]}
    </MonoLabel>
  );
}

interface CountTileProps {
  readonly label: string;
  readonly value: number | undefined;
  readonly accent?: boolean;
}

function CountTile({ label, value, accent = false }: CountTileProps) {
  return (
    /* Grouped and named so the count is read with the thing it counts. */
    <div className={styles.countTile} role="group" aria-label={label}>
      <MonoLabel size="micro" tone="muted" uppercase>
        {label}
      </MonoLabel>
      <span
        className={cx(
          styles.countValue,
          value === undefined ? styles.countValueUnknown : accent && styles.countValuePending,
        )}
      >
        {/* Two dashes, not a zero: an unread count is not a count of none. */}
        {value === undefined ? "——" : padCount(value, 2)}
      </span>
    </div>
  );
}

/** The last outcome of an action on the desk, printed rather than announced. */
interface DeskNotice {
  readonly kind: "ok" | "failure";
  readonly headline: string;
  readonly body: string;
  readonly lines?: readonly string[];
}

/**
 * The analysis desk: how many references are in each state, the two ends of
 * the external-curator loop (export a manifest, import the JSON that comes
 * back), and the newest accessions with their per-reference actions.
 */
export function AnalysisDesk() {
  const stats = useStats();
  const failed = useStatusCount("failed");
  const ledger = useAccessionLedger();
  const invalidate = useArchiveInvalidation();

  const manifest = usePendingManifest();
  const analysisImport = useAnalysisImport();
  const reset = useAnalysisReset();

  const [overwriteProtected, setOverwriteProtected] = useState(false);
  const [notice, setNotice] = useState<DeskNotice | null>(null);
  const [editing, setEditing] = useState<ReferenceResponse | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const importInput = useRef<HTMLInputElement>(null);
  const importInputId = useId();
  const headingId = useId();

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await invalidate();
    } finally {
      setRefreshing(false);
    }
  }, [invalidate]);

  function exportManifest() {
    if (manifest.isPending) return;
    manifest.mutate(undefined, {
      onSuccess: (document_) => {
        const saved = downloadJson("retr0vault-pending-analysis.json", document_);
        setNotice({
          kind: saved ? "ok" : "failure",
          headline: saved
            ? "Pending manifest exported"
            : "The manifest could not be saved",
          body: saved
            ? `${document_.references.length} reference${
                document_.references.length === 1 ? "" : "s"
              } awaiting analysis. Hand the file to Claude Code or Codex, then import the JSON it writes back.`
            : "This browser refused the download. Run npm run analysis:export-pending instead.",
          ...(document_.unavailable.length > 0
            ? {
                lines: document_.unavailable.map(
                  (entry) => `${entry.referenceId} — ${entry.message}`,
                ),
              }
            : {}),
        });
      },
      onError: (error) => {
        setNotice({
          kind: "failure",
          headline: "The manifest could not be read",
          body: describeIngestFailure(error, "read").detail,
        });
      },
    });
  }

  async function onImportFiles(files: FileList | null) {
    if (files === null || files.length === 0 || analysisImport.isPending) return;

    const read = await readAnalysisFiles([...files]);
    // Let the same file be chosen twice in a row.
    if (importInput.current !== null) importInput.current.value = "";

    if (read.entries.length === 0) {
      setNotice({
        kind: "failure",
        headline: "Nothing to import",
        body: "None of those files held an analysis object.",
        lines: read.rejected,
      });
      return;
    }

    if (read.entries.length > MAX_ANALYSES_PER_IMPORT) {
      setNotice({
        kind: "failure",
        headline: "That batch is too large",
        body: `The archive imports up to ${MAX_ANALYSES_PER_IMPORT} analyses at a time; that selection holds ${read.entries.length}.`,
      });
      return;
    }

    analysisImport.mutate(
      {
        analyses: read.entries.map((entry: AnalysisEntry) => entry.value),
        overwriteProtected,
      },
      {
        onSuccess: (report) => {
          /*
           * The backend names each result by its index in the request, so the
           * index is mapped back to the file it came from — a curator reads
           * "stillpage.json", not "3".
           */
          const named = report.results
            .filter((result) => result.status === "failed")
            .map((result) => {
              const source =
                read.entries[Number(result.source)]?.label ?? result.source;
              return `${source} — ${result.error?.code ?? "FAILED"}: ${
                result.error?.message ?? "rejected"
              }`;
            });
          const preserved = report.results.filter(
            (result) => result.preservedFields.length > 0,
          );

          setNotice({
            kind: report.failed === 0 ? "ok" : "failure",
            headline:
              report.failed === 0
                ? "Analysis imported"
                : "Some analyses were rejected",
            body: `${report.imported} imported · ${report.failed} rejected${
              preserved.length > 0
                ? ` · ${preserved.length} left protected fields untouched`
                : ""
            }.`,
            lines: [...named, ...read.rejected],
          });
        },
        onError: (error) => {
          const failure = describeIngestFailure(error, "import");
          setNotice({
            kind: "failure",
            headline: failure.headline,
            body: failure.detail,
            lines: read.rejected,
          });
        },
      },
    );
  }

  function onReset(reference: ReferenceResponse) {
    if (resetting !== null) return;
    setResetting(reference.id);
    reset.mutate(reference.id, {
      onSuccess: () => {
        setNotice({
          kind: "ok",
          headline: "Reset to pending",
          body: `${reference.title} is awaiting analysis again. Its stored metadata is untouched until an import replaces it.`,
        });
      },
      onError: (error) => {
        const failure = describeIngestFailure(error, "reset");
        setNotice({
          kind: "failure",
          headline: failure.headline,
          body: failure.detail,
        });
      },
      onSettled: () => setResetting(null),
    });
  }

  const items = ledger.data?.items ?? [];
  const busy = analysisImport.isPending || manifest.isPending;

  return (
    <section className={styles.desk} aria-labelledby={headingId}>
      <header className={styles.deskHead}>
        <div className={styles.laneHead}>
          <MonoLabel size="small" uppercase marker="square">
            Analysis desk
          </MonoLabel>
          <EditorialHeading level={2} scale="section" id={headingId}>
            Pending analysis
          </EditorialHeading>
        </div>
        <ActionButton variant="outline" size="small" onClick={() => void refresh()}>
          {refreshing ? "Refreshing" : "Refresh status"}
        </ActionButton>
      </header>

      <div className={styles.counts}>
        <CountTile label="Pending" value={stats.data?.pendingReferences} accent />
        <CountTile label="Analyzed" value={stats.data?.analyzedReferences} />
        <CountTile label="Failed" value={failed.data} />
        <CountTile label="In archive" value={stats.data?.totalReferences} />
      </div>

      {stats.isError ? (
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          Counts unavailable — the local API is not answering
        </MonoLabel>
      ) : null}

      <div className={styles.deskActions}>
        <ActionButton
          variant="solid"
          onClick={exportManifest}
          disabled={busy}
          title="Download the manifest of every reference awaiting analysis"
        >
          {manifest.isPending ? "Building" : "Export pending manifest"}
        </ActionButton>

        <input
          ref={importInput}
          id={importInputId}
          className={styles.fileInput}
          type="file"
          accept="application/json,.json"
          multiple
          disabled={busy}
          onChange={(event) => void onImportFiles(event.target.files)}
        />
        <label className={styles.picker} htmlFor={importInputId}>
          {analysisImport.isPending ? "Importing" : "Import analysis JSON"}
        </label>

        <CheckField
          label="Overwrite protected fields"
          checked={overwriteProtected}
          onChange={setOverwriteProtected}
          disabled={busy}
        />
      </div>

      {notice === null ? null : (
        <div
          className={cx(styles.notice, notice.kind === "failure" && styles.noticeFailure)}
          role={notice.kind === "failure" ? "alert" : "status"}
        >
          <p className={styles.noticeTitle}>{notice.headline}</p>
          <p className={styles.noticeBody}>{notice.body}</p>
          {notice.lines && notice.lines.length > 0 ? (
            <div className={styles.noticeList}>
              {notice.lines.map((line, index) => (
                <MonoLabel key={`${index}-${line}`} size="micro" tone="muted">
                  {line}
                </MonoLabel>
              ))}
            </div>
          ) : null}
          <div className={styles.noticeLinks}>
            <ActionButton variant="quiet" size="small" onClick={() => setNotice(null)}>
              Dismiss
            </ActionButton>
          </div>
        </div>
      )}

      <PageRule weight="hairline" />

      <div className={styles.deskHead}>
        <MonoLabel size="small" tone="muted" uppercase>
          Accession ledger · newest first
        </MonoLabel>
        <ActionLink variant="quiet" size="small" to="/all">
          Open the catalogue
        </ActionLink>
      </div>

      {ledger.isPending ? (
        <MonoLabel size="small" tone="muted" uppercase>
          Reading the ledger
        </MonoLabel>
      ) : ledger.isError ? (
        <MonoLabel size="small" uppercase marker="hollow" className={styles.statusFailed}>
          {describeIngestFailure(ledger.error, "read").detail}
        </MonoLabel>
      ) : items.length === 0 ? (
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          No references filed yet
        </MonoLabel>
      ) : (
        <ul className={styles.ledger} aria-label="Accession ledger">
          {items.map((reference, index) => (
            <li key={reference.id} className={styles.ledgerRow}>
              <MonoLabel size="small" className={styles.ledgerIndex}>
                {padCount(index + 1, 2)}
              </MonoLabel>

              <div className={styles.ledgerEntry}>
                <Link to={`/reference/${reference.id}`} className={styles.ledgerTitle}>
                  {reference.title}
                </Link>
                <div className={styles.ledgerMeta}>
                  <StatusMark status={reference.analysisStatus} />
                  <MonoLabel size="micro" tone="muted" uppercase>
                    {reference.sourceType === "website" ? "Capture" : "Image"}
                  </MonoLabel>
                  {reference.protectedFields.length > 0 ? (
                    <MonoLabel size="micro" tone="muted" uppercase>
                      {`${reference.protectedFields.length} protected`}
                    </MonoLabel>
                  ) : null}
                </div>
              </div>

              <div className={styles.ledgerActions}>
                <ActionButton
                  variant="outline"
                  size="small"
                  onClick={() => setEditing(reference)}
                >
                  Edit metadata
                </ActionButton>
                <ActionButton
                  variant="quiet"
                  size="small"
                  disabled={
                    reference.analysisStatus === "pending" || resetting !== null
                  }
                  title={
                    reference.analysisStatus === "pending"
                      ? "Already awaiting analysis"
                      : "Return this reference to the pending queue"
                  }
                  onClick={() => onReset(reference)}
                >
                  {resetting === reference.id ? "Resetting" : "Reset"}
                </ActionButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing === null ? null : (
        <MetadataEditor
          key={editing.id}
          reference={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setNotice({
              kind: "ok",
              headline: "Metadata saved",
              body: `${saved.title} now carries ${saved.protectedFields.length} protected field${
                saved.protectedFields.length === 1 ? "" : "s"
              }.`,
            });
          }}
        />
      )}
    </section>
  );
}
