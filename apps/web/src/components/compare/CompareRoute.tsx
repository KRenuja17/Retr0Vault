import { useMemo, type ReactNode } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { DesignTypeResponse, ReferenceResponse } from "@retr0vault/shared";

import { SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  MonoLabel,
  VocabularyChip,
  VocabularyChipSet,
} from "@/components/primitives";
import { NotEnoughSources, SheetFrame } from "@/components/selection/SheetFrame";
import { SelectionExports } from "@/components/selection/SelectionExports";
import { ApiError } from "@/lib/api/client";
import { originFromState } from "@/lib/catalogue/filters";
import { useDesignTypeIndex, useDesignTypes } from "@/lib/catalogue/useCatalogue";
import {
  readAnalysisDimension,
  type AnalysisDimension,
} from "@/lib/selection/analysis";
import {
  MIN_MULTI_SELECTION,
  parseRefs,
  REFS_PARAM,
} from "@/lib/selection/selection";
import { useSelectedReferences } from "@/lib/selection/useSelectedReferences";

import styles from "./Compare.module.css";

/**
 * One line of the comparison sheet. Every row reads metadata the archive
 * already holds; none of them derives, summarises or fills in anything.
 */
interface CompareRow {
  readonly key: string;
  readonly label: string;
  readonly render: (
    reference: ReferenceResponse,
    designType: DesignTypeResponse | undefined,
  ) => ReactNode;
}

/** Absence, printed quietly. The sheet never invents an observation. */
function Absent() {
  return (
    <span className={styles.absent}>
      <span aria-hidden="true">&mdash;</span>
      <span className="rv-visually-hidden">Not recorded</span>
    </span>
  );
}

function Prose({ value }: { readonly value: string | null }) {
  const text = value?.trim() ?? "";
  return text.length > 0 ? <p className={styles.prose}>{text}</p> : <Absent />;
}

function Observations({ values }: { readonly values: readonly string[] }) {
  if (values.length === 0) {
    return <Absent />;
  }
  return (
    <ul className={styles.observations}>
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

function analysisRow(
  key: string,
  label: string,
  dimensions: readonly AnalysisDimension[],
): CompareRow {
  return {
    key,
    label,
    render: (reference) => (
      <Observations
        values={dimensions.flatMap((dimension) =>
          readAnalysisDimension(reference, dimension),
        )}
      />
    ),
  };
}

const ROWS: readonly CompareRow[] = [
  {
    key: "designType",
    label: "Design type",
    render: (_reference, designType) =>
      designType === undefined ? (
        <Absent />
      ) : (
        <MonoLabel size="small" tone="soft" marker="solid">
          {designType.name}
        </MonoLabel>
      ),
  },
  {
    key: "designDNA",
    label: "Design DNA",
    render: (reference) => <Prose value={reference.designDNA} />,
  },
  {
    key: "designThesis",
    label: "Design thesis",
    render: (reference) => <Prose value={reference.designThesis} />,
  },
  {
    key: "vocabulary",
    label: "Vocabulary",
    render: (reference) =>
      reference.tags.length === 0 ? (
        <Absent />
      ) : (
        <VocabularyChipSet>
          {reference.tags.map((tag) => (
            <VocabularyChip key={tag.id} title={`${tag.type}: ${tag.value}`}>
              {tag.value}
            </VocabularyChip>
          ))}
        </VocabularyChipSet>
      ),
  },
  analysisRow("typography", "Typography", ["typography"]),
  analysisRow("palette", "Colour", ["palette"]),
  analysisRow("layout", "Layout", ["layout"]),
  analysisRow("texture", "Texture / imagery", ["texture", "imagery"]),
  analysisRow("uiPatterns", "UI treatment", ["uiPatterns"]),
  {
    key: "motion",
    label: "Motion",
    render: (reference) => {
      const observed = readAnalysisDimension(reference, "motion");
      const brief = reference.motionBrief?.trim() ?? "";
      if (observed.length === 0 && brief.length === 0) {
        return <Absent />;
      }
      return (
        <>
          {observed.length > 0 ? <Observations values={observed} /> : null}
          {brief.length > 0 ? <p className={styles.prose}>{brief}</p> : null}
        </>
      );
    },
  },
  analysisRow("avoid", "Anti-patterns", ["avoid"]),
];

/**
 * `/compare?refs=...` &mdash; the curator's comparison sheet.
 *
 * The selection lives in the address rather than in history state, so the sheet
 * survives a refresh and can be pasted to someone else. History state carries
 * only the slice it was opened from, which is what CLOSE returns to.
 */
export function CompareRoute() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const origin = originFromState(location.state);

  const raw = searchParams.get(REFS_PARAM);
  const ids = useMemo(() => parseRefs(raw), [raw]);

  const selected = useSelectedReferences(ids);
  const designTypes = useDesignTypes();
  const designTypeIndex = useDesignTypeIndex(designTypes.data);

  if (ids.length < MIN_MULTI_SELECTION) {
    return (
      <NotEnoughSources
        minimum={MIN_MULTI_SELECTION}
        origin={origin}
        what="A comparison"
      />
    );
  }

  return (
    <SheetFrame
      eyebrow="Curator's comparison sheet"
      title="Comparison"
      lede="The selected references read side by side, dimension by dimension, from the analysis the archive already holds. Nothing here is derived: where a reference carries no observation for a dimension, the cell is left empty."
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          {`${String(ids.length).padStart(2, "0")} references`}
        </MonoLabel>
      }
      origin={origin}
    >
      {selected.pending ? (
        <p className={styles.reading}>
          <MonoLabel size="small" tone="muted" uppercase>
            Reading references
          </MonoLabel>
        </p>
      ) : selected.resolved.length === 0 ? (
        <UnreadableSources error={selected.error} />
      ) : (
        <>
          {selected.resolved.length < ids.length ? (
            <p role="status" className={styles.partial}>
              <MonoLabel size="small" uppercase marker="hollow">
                {`${ids.length - selected.resolved.length} of ${ids.length} references could not be read`}
              </MonoLabel>
            </p>
          ) : null}

          {/*
            * A real table: this is tabular data, and row/column headers are
            * what make it readable with a screen reader. The scroll container
            * keeps a wide sheet inside its own bounds rather than pushing the
            * page sideways, and is focusable so it can be scrolled by keyboard.
            */}
          <div
            role="region"
            aria-label="Comparison sheet"
            tabIndex={0}
            className={styles.scroll}
          >
            <table className={styles.table}>
              <caption className="rv-visually-hidden">
                Selected references compared across design type, design DNA,
                design thesis, vocabulary, typography, colour, layout, texture
                and imagery, UI treatment, motion and anti-patterns.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className={styles.corner}>
                    <span className="rv-visually-hidden">Dimension</span>
                  </th>
                  {selected.resolved.map((reference, index) => (
                    <th scope="col" key={reference.id} className={styles.column}>
                      <span className={styles.columnIndex}>
                        <MonoLabel size="micro" tone="muted" uppercase>
                          {String(index + 1).padStart(2, "0")}
                        </MonoLabel>
                        {index === 0 ? (
                          <MonoLabel size="micro" uppercase marker="solid">
                            Primary
                          </MonoLabel>
                        ) : null}
                      </span>
                      <Link
                        to={`/reference/${reference.id}`}
                        state={{ origin }}
                        className={styles.columnTitle}
                      >
                        {reference.title}
                      </Link>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((row) => (
                  <tr key={row.key}>
                    <th scope="row" className={styles.rowLabel}>
                      <MonoLabel size="small" tone="muted" uppercase>
                        {row.label}
                      </MonoLabel>
                    </th>
                    {selected.resolved.map((reference) => (
                      <td key={reference.id} className={styles.cell}>
                        {row.render(
                          reference,
                          reference.designTypeId === null
                            ? undefined
                            : designTypeIndex.get(reference.designTypeId),
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <SelectionExports
            referenceIds={selected.resolved.map((reference) => reference.id)}
            includeManifest
            className={styles.exports}
          />
        </>
      )}
    </SheetFrame>
  );
}

function UnreadableSources({ error }: { readonly error: unknown }) {
  const offline = error instanceof ApiError && error.isOffline;

  return (
    <SectionPanel
      eyebrow="Comparison unavailable"
      title={
        offline
          ? "The archive is not answering"
          : "Those references could not be read"
      }
      marker
      lede={
        offline
          ? "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api and reload."
          : "None of the selected references came back. They may have been removed from the archive since the selection was made."
      }
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          No sources
        </MonoLabel>
      }
    >
      {error instanceof ApiError ? (
        <MonoLabel size="small" tone="muted">
          {`${error.code} · ${error.statusCode}`}
        </MonoLabel>
      ) : null}
    </SectionPanel>
  );
}
