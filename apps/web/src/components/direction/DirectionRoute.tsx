import { useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";

import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import { ActionButton, MonoLabel, PageRule } from "@/components/primitives";
import { TextAreaField } from "@/components/ingest/Field";
import { NotEnoughSources, SheetFrame } from "@/components/selection/SheetFrame";
import {
  ExportStatusLine,
  SelectionExports,
} from "@/components/selection/SelectionExports";
import { useMarkdownExport } from "@/components/selection/useMarkdownExport";
import {
  exportAuthoredDirection,
  exportPendingCombination,
} from "@/lib/api/exports";
import { originFromState } from "@/lib/catalogue/filters";
import {
  MIN_MULTI_SELECTION,
  parseRefs,
  REFS_PARAM,
} from "@/lib/selection/selection";
import { useSelectedReferences } from "@/lib/selection/useSelectedReferences";

import styles from "./Direction.module.css";

/** What the backend's manifest instructs the external curator to produce. */
const MANIFEST_ASKS: readonly string[] = [
  "Identify what to borrow from each selected reference",
  "Detect where the references contradict one another",
  "Assign authority for each design dimension to one reference",
  "Resolve the contradictions rather than averaging them",
  "State one coherent direction, with anti-patterns",
];

const AUTHORED_PLACEHOLDER_HINT =
  'Paste the curator’s reviewed JSON result, or choose the file. Either the whole request body ({ "mode": "authored", "referenceIds": [...], "direction": {...} }) or a bare direction object is accepted.';

interface AuthoredPayload {
  readonly referenceIds: readonly string[];
  readonly direction: unknown;
}

/**
 * Reads whatever the curator handed back. The manifest tells them to submit the
 * complete request body, so that shape is taken as given; a bare direction
 * object is also accepted and paired with the selection in the address.
 *
 * Nothing is validated here beyond the envelope: the export endpoint owns the
 * direction contract and answers with path-qualified messages, and duplicating
 * that check in the browser would only let the two drift apart.
 */
function readAuthored(
  raw: string,
  referenceIds: readonly string[],
): AuthoredPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error("That is not valid JSON. Paste the curator's result exactly as it was written.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("A direction result must be a JSON object.");
  }

  const candidate = parsed as {
    mode?: unknown;
    referenceIds?: unknown;
    direction?: unknown;
  };

  if (candidate.mode === "authored" && candidate.direction !== undefined) {
    const supplied = Array.isArray(candidate.referenceIds)
      ? candidate.referenceIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [];
    return {
      referenceIds: supplied.length > 0 ? supplied : referenceIds,
      direction: candidate.direction,
    };
  }

  return { referenceIds, direction: parsed };
}

/**
 * `/direction?refs=...` &mdash; the design synthesis worksheet.
 *
 * Retr0Vault has no AI API and does not acquire one here. The worksheet is the
 * two halves of an external round trip: it generates the combination manifest
 * an agent processes, and it formats the direction that agent authored. The
 * synthesis itself happens in Claude Code or Codex, never in this browser.
 */
export function DirectionRoute() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const origin = originFromState(location.state);

  const raw = searchParams.get(REFS_PARAM);
  const ids = useMemo(() => parseRefs(raw), [raw]);
  const selected = useSelectedReferences(ids);

  const [intent, setIntent] = useState("");
  const [authored, setAuthored] = useState("");
  const [authoredError, setAuthoredError] = useState<string | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const manifest = useMarkdownExport();
  const direction = useMarkdownExport();

  if (ids.length < MIN_MULTI_SELECTION) {
    return (
      <NotEnoughSources
        minimum={MIN_MULTI_SELECTION}
        origin={origin}
        what="A design direction"
      />
    );
  }

  async function onChooseFile(file: File | undefined): Promise<void> {
    if (file === undefined) {
      return;
    }
    setAuthoredError(undefined);
    setAuthored(await file.text());
  }

  function submitAuthored(): void {
    setAuthoredError(undefined);
    let payload: AuthoredPayload;
    try {
      payload = readAuthored(authored, ids);
    } catch (error) {
      setAuthoredError(
        error instanceof Error ? error.message : "That result could not be read.",
      );
      return;
    }
    void direction.run("Design direction", () =>
      // The direction shape is the endpoint's to judge; it is sent as written.
      exportAuthoredDirection(
        payload.referenceIds,
        payload.direction as Parameters<typeof exportAuthoredDirection>[1],
      ),
    );
  }

  return (
    <SheetFrame
      eyebrow="Design synthesis worksheet"
      title="Create direction"
      lede="One coherent direction out of several references, authored outside the archive. Retr0Vault writes the manifest and formats the result; the comparison, the conflict resolution and the decisions are made by Claude Code or Codex reading that manifest."
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          {`${String(ids.length).padStart(2, "0")} sources`}
        </MonoLabel>
      }
      origin={origin}
    >
      <section className={styles.block} aria-labelledby="direction-sources">
        <h2 id="direction-sources" className={styles.blockTitle}>
          <MonoLabel size="small" tone="muted" uppercase>
            Sources
          </MonoLabel>
        </h2>
        <ol className={styles.sources}>
          {selected.entries.map((entry, index) => (
            <li key={entry.id} className={styles.source}>
              <MonoLabel size="micro" tone="muted" className={styles.sourceIndex}>
                {String(index + 1).padStart(2, "0")}
              </MonoLabel>
              {entry.reference === undefined ? (
                <MonoLabel size="small" tone="muted">
                  {selected.pending ? "Reading" : "Could not be read"}
                </MonoLabel>
              ) : (
                <Link
                  to={`/reference/${entry.id}`}
                  state={{ origin }}
                  className={styles.sourceTitle}
                >
                  {entry.reference.title}
                </Link>
              )}
              {index === 0 ? (
                <MonoLabel size="micro" uppercase marker="solid">
                  Primary
                </MonoLabel>
              ) : null}
            </li>
          ))}
        </ol>
        <p className={styles.note}>
          The first source is the starting point the manifest names, not blanket
          authority: the curator is asked to assign authority per dimension.
        </p>
      </section>

      <PageRule weight="dotted" />

      <section className={styles.block} aria-labelledby="direction-intent">
        <h2 id="direction-intent" className={styles.blockTitle}>
          <MonoLabel size="small" tone="muted" uppercase>
            01 — Intent
          </MonoLabel>
        </h2>
        <TextAreaField
          label="What the direction is for"
          note="Optional"
          value={intent}
          onChange={setIntent}
          rows={3}
          hint="Carried into the manifest as the brief the curator works to. Up to 5,000 characters."
          className={styles.intent}
        />
      </section>

      <PageRule weight="dotted" />

      <section className={styles.block} aria-labelledby="direction-manifest">
        <h2 id="direction-manifest" className={styles.blockTitle}>
          <MonoLabel size="small" tone="muted" uppercase>
            02 — Combination manifest
          </MonoLabel>
        </h2>
        <p className={styles.note}>
          A Markdown manifest carrying the selected sources, their full recorded
          analysis, and the JSON Schema for the authored result. Hand it to
          Claude Code or Codex.
        </p>
        <div className={styles.asks}>
          <ManifestList label="What the manifest asks for" items={MANIFEST_ASKS} />
        </div>
        <div className={styles.actions}>
          <ActionButton
            variant="solid"
            disabled={manifest.busy}
            onClick={() => {
              void manifest.run("Combination manifest", () =>
                exportPendingCombination(ids, intent),
              );
            }}
          >
            Generate manifest
          </ActionButton>
        </div>
        <ExportStatusLine exporter={manifest} />
      </section>

      <PageRule weight="dotted" />

      <section className={styles.block} aria-labelledby="direction-import">
        <h2 id="direction-import" className={styles.blockTitle}>
          <MonoLabel size="small" tone="muted" uppercase>
            03 — Authored direction
          </MonoLabel>
        </h2>
        <p className={styles.note}>
          Bring the reviewed result back. The archive validates it against the
          direction contract and formats it as
          <code className={styles.code}>retr0vault-direction.md</code>, ready for
          a design-direction.md in a coding-agent project.
        </p>

        <div className={styles.fileRow}>
          <label htmlFor="direction-file">
            <MonoLabel size="small" uppercase>
              Result file
            </MonoLabel>
          </label>
          <input
            id="direction-file"
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className={styles.file}
            onChange={(event) => {
              void onChooseFile(event.target.files?.[0]);
            }}
          />
        </div>

        <TextAreaField
          label="Direction JSON"
          note="Required"
          value={authored}
          onChange={(value) => {
            setAuthored(value);
            setAuthoredError(undefined);
          }}
          rows={8}
          mono
          hint={AUTHORED_PLACEHOLDER_HINT}
          {...(authoredError === undefined ? {} : { error: authoredError })}
          className={styles.intent}
        />

        <div className={styles.actions}>
          <ActionButton
            variant="solid"
            disabled={authored.trim().length === 0 || direction.busy}
            onClick={submitAuthored}
          >
            Format direction
          </ActionButton>
          <ActionButton
            variant="quiet"
            disabled={authored.length === 0}
            onClick={() => {
              setAuthored("");
              setAuthoredError(undefined);
              direction.reset();
              if (fileInput.current !== null) {
                fileInput.current.value = "";
              }
            }}
          >
            Clear
          </ActionButton>
        </div>
        <ExportStatusLine exporter={direction} />
      </section>

      <SectionPanel
        eyebrow="What the archive keeps"
        title="Directions are not stored"
        aside={
          <MonoLabel size="small" tone="muted" uppercase marker="hollow">
            Export round trip
          </MonoLabel>
        }
        lede="The export endpoints are read-only. A direction is generated, validated and downloaded; the archive holds no direction record, so there is nothing to reopen here later. Keep the Markdown file with the project it belongs to."
        className={styles.limitation}
      />

      <SelectionExports referenceIds={ids} className={styles.exports} />
    </SheetFrame>
  );
}
