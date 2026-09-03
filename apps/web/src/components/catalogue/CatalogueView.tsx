import { useCallback, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";

import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  ActionLink,
  CatalogueGrid,
  MonoLabel,
  PageRule,
  padCount,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import type { CatalogueFilter } from "@/lib/catalogue/filters";
import {
  ALL_FILTER,
  CATALOGUE_PAGE_SIZE,
  filterQuery,
  filterToPath,
  QUERY_PARAM,
  withQuery,
} from "@/lib/catalogue/filters";
import {
  useCatalogueReferences,
  useDesignTypeIndex,
  useDesignTypes,
} from "@/lib/catalogue/useCatalogue";
import { cx } from "@/lib/cx";
import { useSelection } from "@/lib/selection/SelectionProvider";

import { SelectionBar } from "@/components/selection/SelectionBar";

import { ArchiveSearch, QuotedQuery, SearchSuggestions } from "./ArchiveSearch";
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
  const [searchParams, setSearchParams] = useSearchParams();
  const selection = useSelection();
  const designTypes = useDesignTypes();
  const designTypeIndex = useDesignTypeIndex(designTypes.data);

  /*
   * The query comes from the address on a catalogue route. On /reference/:id
   * the address belongs to the sheet, so the query travels on the filter
   * instead — that is what returns the reader to the same search on close.
   */
  const active = withQuery(
    filter,
    filter.query ?? searchParams.get(QUERY_PARAM) ?? "",
  );
  const query = filterQuery(active);
  const catalogue = useCatalogueReferences(active);

  const search = useCallback(
    (next: string) => {
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next.length > 0) {
            params.set(QUERY_PARAM, next);
          } else {
            params.delete(QUERY_PARAM);
          }
          return params;
        },
        // A search is a place, not a step: each one is its own history entry
        // so Back walks out of a search rather than through every keystroke.
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const { items, total } = catalogue;
  const shown = items.length;

  return (
    <div className={styles.view}>
      <FilterRail active={active} />
      <PageRule weight="hairline" />
      <ArchiveSearch
        query={query}
        onSubmit={search}
        filter={active}
        label={label}
      />
      <PageRule weight="hairline" space="tight" />

      {/*
        * Marking sits above the plates and below the search, so a selection
        * made inside one search survives being narrowed by the next.
        */}
      {missing || selection === null ? null : (
        <SelectionBar selection={selection} origin={active} />
      )}

      {missing ? null : intro}

      {missing ? (
        <MissingSliceState filter={active} label={label} />
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
        query.length > 0 ? (
          <NoMatchesState
            query={query}
            filter={active}
            label={label}
            onSearch={search}
          />
        ) : (
          <EmptyState filter={active} label={label} />
        )
      ) : (
        <>
          <div className={styles.ledger}>
            <MonoLabel size="small" tone="muted" uppercase>
              {query.length > 0 ? (
                <>
                  {`${label} matching `}
                  <QuotedQuery query={query} />
                </>
              ) : (
                label
              )}
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
                origin={active}
                {...(selection === null || !selection.active
                  ? {}
                  : {
                      marking: {
                        marked: selection.isSelected(reference.id),
                        blocked:
                          selection.full && !selection.isSelected(reference.id),
                        onToggle: () => selection.toggle(reference.id),
                      },
                    })}
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

/**
 * A search that matched nothing. Distinct from an empty slice: the archive
 * holds plates, this query simply reached none of them, so the way out is a
 * different query rather than adding a reference.
 */
function NoMatchesState({
  query,
  filter,
  label,
  onSearch,
}: {
  readonly query: string;
  readonly filter: CatalogueFilter;
  readonly label: string;
  readonly onSearch: (query: string) => void;
}) {
  return (
    <SectionPanel
      eyebrow="No matches"
      title={
        <>
          {"Nothing in the archive matches "}
          <QuotedQuery query={query} />
        </>
      }
      marker
      lede={
        filter.kind === "all"
          ? "The index covers titles, design DNA, thesis, vocabulary, design type, briefs, image recipes and source addresses. Every word has to match somewhere on the same reference."
          : `Nothing under ${label} matches that. Clear the search to read the whole slice, or search the complete archive instead.`
      }
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker="hollow">
          00 references
        </MonoLabel>
      }
    >
      <div className={styles.stateActions}>
        <ActionButton variant="solid" onClick={() => onSearch("")}>
          Clear search
        </ActionButton>
        {filter.kind === "all" ? null : (
          <ActionLink
            variant="outline"
            to={filterToPath(withQuery(ALL_FILTER, query))}
          >
            Search the whole archive
          </ActionLink>
        )}
      </div>
      <SearchSuggestions onChoose={onSearch} />
    </SectionPanel>
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
