import { useParams } from "react-router-dom";

import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import { CatalogueView } from "@/components/catalogue/CatalogueView";
import { MonoLabel } from "@/components/primitives";
import {
  useCollections,
  useDesignTypes,
} from "@/lib/catalogue/useCatalogue";

/** `/all` — the complete catalogue. */
export function AllRoute() {
  return <CatalogueView filter={{ kind: "all" }} label="Complete archive" />;
}

/**
 * `/type/:slug` — the catalogue filtered to one design type. The style-guide
 * header that belongs above these plates is a later phase; this route only
 * carries the filter.
 */
export function DesignTypeRoute() {
  const { slug = "" } = useParams<{ slug: string }>();
  const designTypes = useDesignTypes();

  const match = designTypes.data?.find((designType) => designType.slug === slug);
  const resolved = designTypes.data !== undefined;

  return (
    <CatalogueView
      filter={{ kind: "designType", slug }}
      label={match?.name ?? slug}
      missing={resolved && match === undefined}
    />
  );
}

/**
 * `/collection/:slug` — the catalogue filtered to one collection. Creating,
 * renaming and editing membership belong to a later phase.
 */
export function CollectionRoute() {
  const { slug = "" } = useParams<{ slug: string }>();
  const collections = useCollections();

  const match = collections.data?.find((collection) => collection.slug === slug);
  const resolved = collections.data !== undefined;

  return (
    <CatalogueView
      filter={{ kind: "collection", slug }}
      label={match?.name ?? slug}
      missing={resolved && match === undefined}
    />
  );
}

/** `/reference/:id` — route-backed detail state; the modal is a later phase. */
export function ReferenceRoute() {
  const { id = "" } = useParams<{ id: string }>();

  return (
    <SectionPanel
      eyebrow="Reference"
      title="Reference detail"
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route · /reference/{id.slice(0, 8)}
        </MonoLabel>
      }
      lede="Opening a plate will raise the large detail modal over a darkened catalogue. This route exists so a reference stays linkable and survives a reload."
    >
      <ManifestList
        label="Next in this view"
        items={[
          "Large reference frame",
          "Title with Design DNA",
          "Design thesis",
          "Visual vocabulary",
          "Image recipe block",
          "COPY BRIEF / COPY IMAGE RECIPE / CLOSE",
        ]}
      />
    </SectionPanel>
  );
}

/** Anything else. */
export function NotFoundRoute() {
  return (
    <SectionPanel
      eyebrow="404"
      title="No such plate"
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route not found
        </MonoLabel>
      }
      lede="That address is not part of the archive. The catalogue is at /all."
    />
  );
}
