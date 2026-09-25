import { useId, useRef, useState } from "react";

import { ActionButton, ActionLink, EditorialHeading, MonoLabel, padCount } from "@/components/primitives";
import { useStats } from "@/lib/catalogue/useCatalogue";
import { cx } from "@/lib/cx";
import { describeIngestFailure } from "@/lib/ingest/errors";
import { downloadJson, MAX_ANALYSES_PER_IMPORT, readAnalysisFiles } from "@/lib/ingest/analysisFiles";
import { useMotionImport, usePendingMotionManifest } from "@/lib/motion/useMotion";

import { CheckField } from "@/components/ingest/Field";
import ingest from "@/components/ingest/Ingest.module.css";

interface DeskNotice {
  readonly kind: "ok" | "failure";
  readonly headline: string;
  readonly body: string;
  readonly lines?: readonly string[];
}

function CountTile({ label, value, accent = false }: { readonly label: string; readonly value: number | undefined; readonly accent?: boolean }) {
  return (
    <div className={ingest.countTile} role="group" aria-label={label}>
      <MonoLabel size="micro" tone="muted" uppercase>{label}</MonoLabel>
      <span className={cx(ingest.countValue, value === undefined ? ingest.countValueUnknown : accent && ingest.countValuePending)}>
        {value === undefined ? "——" : padCount(value, 2)}
      </span>
    </div>
  );
}

/**
 * The motion side of the curator loop: how many studies wait for analysis, the
 * manifest of their evidence, and the JSON that comes back. The same loop as
 * design analysis, run separately, so neither ever overwrites the other.
 */
export function MotionDesk() {
  const stats = useStats();
  const manifest = usePendingMotionManifest();
  const motionImport = useMotionImport();
  const [overwriteProtected, setOverwriteProtected] = useState(false);
  const [notice, setNotice] = useState<DeskNotice | null>(null);
  const importInput = useRef<HTMLInputElement>(null);
  const importInputId = useId();
  const headingId = useId();
  const counts = stats.data?.motionStudies;

  function exportManifest() {
    if (manifest.isPending) return;
    manifest.mutate(undefined, {
      onSuccess: (document_) => {
        const saved = downloadJson("retr0vault-pending-motion.json", document_);
        setNotice({
          kind: saved ? "ok" : "failure",
          headline: saved ? "Pending motion manifest exported" : "The manifest could not be saved",
          body: saved
            ? `${document_.studies.length} stud${document_.studies.length === 1 ? "y" : "ies"} ready for motion analysis. The manifest points at the evidence on this machine, so run the curator where the files are, or use npm run motion:export-pending for the same file plus its instructions.`
            : "This browser refused the download. Run npm run motion:export-pending instead.",
          ...(document_.unavailable.length > 0 ? { lines: document_.unavailable.map((entry) => `${entry.referenceId} — ${entry.message}`) } : {}),
        });
      },
      onError: (error) => setNotice({ kind: "failure", headline: "The manifest could not be read", body: describeIngestFailure(error, "read").detail }),
    });
  }

  async function onImportFiles(files: FileList | null) {
    if (files === null || files.length === 0 || motionImport.isPending) return;
    const read = await readAnalysisFiles([...files]);
    if (importInput.current !== null) importInput.current.value = "";
    if (read.entries.length === 0) {
      setNotice({ kind: "failure", headline: "Nothing to import", body: "None of those files held a motion analysis object.", lines: read.rejected });
      return;
    }
    if (read.entries.length > MAX_ANALYSES_PER_IMPORT) {
      setNotice({ kind: "failure", headline: "That batch is too large", body: `The archive imports up to ${MAX_ANALYSES_PER_IMPORT} analyses at a time.` });
      return;
    }
    motionImport.mutate({ analyses: read.entries.map((entry) => entry.value), overwriteProtected }, {
      onSuccess: (report) => {
        const named = report.results.filter((result) => result.status === "failed").map((result) =>
          `${read.entries[Number(result.source)]?.label ?? result.source} — ${result.error?.code ?? "FAILED"}: ${result.error?.message ?? "rejected"}`);
        const preserved = report.results.filter((result) => result.preservedFields.length > 0);
        setNotice({
          kind: report.failed === 0 ? "ok" : "failure",
          headline: report.failed === 0 ? "Motion analysis imported" : "Some motion analyses were rejected",
          body: `${report.imported} imported · ${report.failed} rejected${preserved.length > 0 ? ` · ${preserved.length} left protected fields untouched` : ""}.`,
          lines: [...named, ...read.rejected],
        });
      },
      onError: (error) => {
        const failure = describeIngestFailure(error, "import");
        setNotice({ kind: "failure", headline: failure.headline, body: failure.detail, lines: read.rejected });
      },
    });
  }

  return (
    <section className={ingest.desk} aria-labelledby={headingId}>
      <header className={ingest.deskHead}>
        <MonoLabel size="small" uppercase marker="square">Motion desk</MonoLabel>
        <EditorialHeading level={2} scale="section" id={headingId}>Motion analysis</EditorialHeading>
        <p className={ingest.laneNote}>
          Export the evidence of every study awaiting motion analysis — energy timelines, region maps, smart keyframes,
          burst strips and your inspection notes — then import the JSON a coding agent writes back. See docs/motion-analysis.md.
        </p>
      </header>

      <div className={ingest.counts}>
        <CountTile label="Motion studies" value={counts?.total} />
        <CountTile label="Awaiting motion analysis" value={counts?.pending} accent />
        <CountTile label="Analyzed" value={counts?.analyzed} />
        <CountTile label="Manual" value={counts?.manual} />
      </div>

      <div className={ingest.deskActions}>
        <ActionButton variant="solid" onClick={exportManifest} disabled={manifest.isPending}>
          {manifest.isPending ? "Reading" : "Export pending motion"}
        </ActionButton>
        <input
          ref={importInput}
          id={importInputId}
          className={ingest.fileInput}
          type="file"
          accept="application/json,.json"
          multiple
          disabled={motionImport.isPending}
          onChange={(event) => void onImportFiles(event.target.files)}
        />
        <label className={ingest.picker} htmlFor={importInputId}>
          {motionImport.isPending ? "Importing" : "Import motion analysis JSON"}
        </label>
        <ActionLink variant="quiet" size="small" to="/motion">Open the Motion section</ActionLink>
      </div>

      <CheckField
        label="Overwrite protected fields"
        checked={overwriteProtected}
        onChange={setOverwriteProtected}
        disabled={motionImport.isPending}
        hint="Only for this import. Fields you edited on a motion sheet are otherwise kept."
      />

      <MonoLabel size="micro" tone="muted">
        npm run motion:export-pending · npm run motion:import
      </MonoLabel>

      {notice === null ? null : (
        <div className={cx(ingest.notice, notice.kind === "failure" && ingest.noticeFailure)} role={notice.kind === "failure" ? "alert" : "status"}>
          <p className={ingest.noticeTitle}>{notice.headline}</p>
          <p className={ingest.noticeBody}>{notice.body}</p>
          {notice.lines !== undefined && notice.lines.length > 0 ? (
            <ul className={ingest.noticeList}>
              {notice.lines.map((line) => <li key={line}><MonoLabel size="micro" tone="soft">{line}</MonoLabel></li>)}
            </ul>
          ) : null}
          <div className={ingest.noticeLinks}>
            <ActionButton variant="quiet" size="small" onClick={() => setNotice(null)}>Dismiss</ActionButton>
          </div>
        </div>
      )}
    </section>
  );
}
