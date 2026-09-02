import type { ReactNode } from "react";

import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  CatalogueGrid,
  MonoLabel,
  PageRule,
  padCount,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import type { CatalogueFilter } from "@/lib/catalogue/filters";
import { CATALOGUE_PAGE_SIZE } from "@/lib/catalogue/filters";
import {
  useCatalogueReferences,
  useDesignTypeIndex,
  useDesignTypes,
} from "@/lib/catalogue/useCatalogue";
import { cx } from "@/lib/cx";

import { FilterRail } from "./FilterRail";
import { ReferenceCard } from "./ReferenceCard";
import styles from "./CatalogueView.module.css";

export interface CatalogueViewProps {
  readonly filter: CatalogueFilter;
  /** Human-readable name of the active slice, used in the empty state. */
  readonly label: string;
  /**
   * The slug in the URL matches no design type or collection. The backend
   * answers an unknown slug with an empty page rather than a 404, so the route
   * tells the view what it found.
   */
  readonly missing?: boolean;
  /**
   * Content between the filter rail and the plates — the design-type style
   * guide. Rendered whatever the catalogue's own state, so a type with no
   * references still explains itself.
   */
  readonly intro?: ReactNode;
}

/** Bordered plates that hold the grid's rhythm while the first page loads. */
function LoadingPlates() {
  return (
    <CatalogueGrid className={styles.grid} aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className={styles.ghost}>
          <div className={styles.ghostMedia} />
          <div className={styles.ghostBody}>
            <div className={cx(styles.ghostLine, styles.ghostLineWide)} />
            <div className={styles.ghostLine} />
            <div className={cx(styles.ghostLine, styles.ghostLineNarrow)} />
          </div>
        </div>
      ))}
    </CatalogueGrid>
  );
}

function describeError(error: unknown): {
  readonly title: string;
  readonly lede: string;
  readonly detail: string | undefined;
} {
  if (error instanceof ApiError && error.isOffline) {
    return {
      title: "The archive is not answering",
      lede: "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api and try again.",
      detail: undefined,
    };
  }
  if (error instanceof ApiError) {
    return {
      title: "The archive refused that request",
      lede: error.message,
      detail: `${error.code} · ${error.statusCode}${
        error.requestId ? ` · request ${error.requestId}` : ""
      }`,
    };
  }
  return {
    title: "The catalogue could not be read",
    lede: "Something failed between the browser and the local API.",
    detail: error instanceof Error ? error.message : undefined,
  };
}

/**
 * The catalogue itself: filter rail, plate grid, and every state the archive
 * can be in. Used unchanged by /all, /type/:slug and /collection/:slug — the
 * route supplies the filter, nothing here is hard-coded.
 */
export function CatalogueView({
  filter,
  label,
  missing = false,
  intro,
}: CatalogueViewProps) {
  const designTypes = useDesignTypes();
  const designTypeIndex = useDesignTypeIndex(designTypes.data);
  const catalogue = useCatalogueReferences(filter);

  const { items, total } = catalogue;
  const shown = items.length;

  return (
    <div className={styles.view}>
      <FilterRail active={filter} />
      <PageRule weight="hairline" />

      {missing ? null : intro}

      {missing ? (
        <MissingSliceState filter={filter} label={label} />
      ) : catalogue.isPending ? (
        <>
          <div className={styles.ledger}>
            <MonoLabel size="small" tone="muted" uppercase>
              Reading catalogue
            </MonoLabel>
          </div>
          <LoadingPlates />
        </>
      ) : catalogue.isError ? (
        <ErrorState
          error={catalogue.error}
          onRetry={() => void catalogue.refetch()}
          retrying={catalogue.isFetching}
        />
      ) : total === 0 ? (
        <EmptyState filter={filter} label={label} />
      ) : (
        <>
          <div className={styles.ledger}>
            <MonoLabel size="small" tone="muted" uppercase>
              {label}
            </MonoLabel>
            <MonoLabel size="small" tone="muted" uppercase>
              {`Showing ${padCount(shown, 2)} of ${padCount(total, 2)}`}
            </MonoLabel>
          </div>

          <CatalogueGrid className={styles.grid}>
            {items.map((reference, index) => (
              <ReferenceCard
                key={reference.id}
                reference={reference}
                total={total}
                designType={
                  reference.designTypeId === null
                    ? undefined
                    : designTypeIndex.get(reference.designTypeId)
                }
                eager={index < 3}
                origin={filter}
              />
            ))}
          </CatalogueGrid>

          {catalogue.hasNextPage ? (
            <>
              <PageRule weight="dotted" />
              <div className={styles.more}>
                <ActionButton
                  variant="outline"
                  disabled={catalogue.isFetchingNextPage}
                  onClick={() => void catalogue.fetchNextPage()}
                >
                  {catalogue.isFetchingNextPage
                    ? "Loading"
                    : `Load next ${Math.min(CATALOGUE_PAGE_SIZE, total - shown)}`}
                </ActionButton>
                <MonoLabel size="micro" tone="muted" uppercase>
                  {`${total - shown} remaining`}
                </MonoLabel>
              </div>
            </>
          ) : total > CATALOGUE_PAGE_SIZE ? (
            <>
              <PageRule weight="dotted" />
              <div className={styles.exhausted}>
                <MonoLabel size="micro" tone="muted" uppercase>
                  End of catalogue
                </MonoLabel>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}

function ErrorState({
  error,
  onRetry,
  retrying,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
  readonly retrying: boolean;
}) {
  const described = describeError(error);

  return (
    <SectionPanel
      eyebrow="Catalogue unavailable"
      title={described.title}
      marker
      lede={described.lede}
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          No plates loaded
        </MonoLabel>
      }
    >
      {described.detail ? (
        <MonoLabel size="small" tone="muted" className={styles.errorDetail}>
          {described.detail}
        </MonoLabel>
      ) : null}
      <div className={styles.stateActions}>
        <ActionButton variant="solid" onClick={onRetry} disabled={retrying}>
          {retrying ? "Retrying" : "Retry"}
        </ActionButton>
      </div>
    </SectionPanel>
  );
}

function MissingSliceState({
  filter,
  label,
}: {
  readonly filter: CatalogueFilter;
  readonly label: string;
}) {
  const noun = filter.kind === "collection" ? "collection" : "design type";

  return (
    <SectionPanel
      eyebrow="Not in the archive"
      title={`No ${noun} called ${label}`}
      marker
      lede={`The address is well formed, but the archive holds no ${noun} under that slug. Pick one from the rail above.`}
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          Unknown slug
        </MonoLabel>
      }
    />
  );
}

function EmptyState({
  filter,
  label,
}: {
  readonly filter: CatalogueFilter;
  readonly label: string;
}) {
  if (filter.kind === "all") {
    return (
      <SectionPanel
        eyebrow="Empty archive"
        title="Nothing catalogued yet"
        marker
        lede="Retr0Vault is running and the local API is answering — there are simply no references stored. Add one and it will appear here as a plate, pending analysis."
        aside={
          <MonoLabel size="small" tone="muted" uppercase>
            00 references
          </MonoLabel>
        }
      >
        <ManifestList
          label="How references arrive"
          items={[
            "Upload an image reference",
            "Capture a public website URL",
            "Export the pending manifest",
            "Analyse it with Claude Code or Codex",
            "Import the analysis JSON",
          ]}
        />
      </SectionPanel>
    );
  }

  return (
    <SectionPanel
      eyebrow={filter.kind === "collection" ? "Empty collection" : "Empty design type"}
      title={`No plates under ${label}`}
      marker
      lede={
        filter.kind === "collection"
          ? "This collection has no references yet. References are added to a collection from the archive itself."
          : "No reference carries this design type yet. The type still exists as a style guide, it just has nothing filed under it."
      }
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          00 references
        </MonoLabel>
      }
    />
  );
}
