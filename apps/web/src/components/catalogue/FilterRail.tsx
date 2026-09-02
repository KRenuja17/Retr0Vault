import { FilterTab, MonoLabel } from "@/components/primitives";
import {
  pinnedCollections,
  useCollections,
  useDesignTypes,
  useStats,
} from "@/lib/catalogue/useCatalogue";
import {
  filterToPath,
  isSameFilter,
  type CatalogueFilter,
} from "@/lib/catalogue/filters";

import styles from "./FilterRail.module.css";

export interface FilterRailProps {
  readonly active: CatalogueFilter;
}

const PLACEHOLDER_WIDTHS = ["5rem", "12rem", "9rem", "14rem", "11rem", "10rem"];

/**
 * The catalogue's filter rail: ALL, then every design type in its configured
 * order, then pinned collections. Counts are read live from the backend — none
 * of them are hard-coded — and the active tab is derived from the route.
 */
export function FilterRail({ active }: FilterRailProps) {
  const designTypes = useDesignTypes();
  const collections = useCollections();
  const stats = useStats();

  const isLoading =
    designTypes.isPending || collections.isPending || stats.isPending;
  const failed = designTypes.isError && collections.isError;

  if (isLoading) {
    return (
      <nav className={styles.rail} aria-label="Catalogue filters">
        <div className={styles.placeholder} aria-hidden="true">
          {PLACEHOLDER_WIDTHS.map((width) => (
            <div
              key={width}
              className={styles.placeholderTab}
              style={{ width }}
            />
          ))}
        </div>
        <span className="rv-visually-hidden">Loading catalogue filters</span>
      </nav>
    );
  }

  if (failed) {
    return (
      <nav className={styles.rail} aria-label="Catalogue filters">
        <div className={styles.railError}>
          <MonoLabel size="small" tone="soft" uppercase marker="hollow">
            Filters unavailable
          </MonoLabel>
          <MonoLabel size="small" tone="muted">
            the local API is not answering
          </MonoLabel>
        </div>
      </nav>
    );
  }

  const pinned = pinnedCollections(collections.data);

  return (
    <nav className={styles.rail} aria-label="Catalogue filters">
      <div className={styles.tabs}>
        <FilterTab
          label="All"
          {...(stats.data ? { count: stats.data.totalReferences } : {})}
          to={filterToPath({ kind: "all" })}
          active={isSameFilter(active, { kind: "all" })}
        />

        {(designTypes.data ?? []).map((designType) => (
          <FilterTab
            key={designType.id}
            label={designType.name}
            count={designType.referenceCount}
            to={filterToPath({ kind: "designType", slug: designType.slug })}
            active={isSameFilter(active, {
              kind: "designType",
              slug: designType.slug,
            })}
            title={designType.description}
          />
        ))}

        {pinned.length > 0 ? (
          <span className={styles.collectionGroup}>
            {pinned.map((collection) => (
              <FilterTab
                key={collection.id}
                label={collection.name}
                count={collection.referenceCount}
                marker
                to={filterToPath({ kind: "collection", slug: collection.slug })}
                active={isSameFilter(active, {
                  kind: "collection",
                  slug: collection.slug,
                })}
                title={collection.description || "Pinned collection"}
              />
            ))}
          </span>
        ) : null}
      </div>
    </nav>
  );
}
