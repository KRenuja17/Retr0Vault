import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { SectionPanel } from "@/components/layout/SectionPanel";
import { CatalogueView } from "@/components/catalogue/CatalogueView";
import { DesignTypeGuide } from "@/components/design-type/DesignTypeGuide";
import { ReferenceModal } from "@/components/reference/ReferenceModal";
import {
  filterLabel,
  filterToPath,
  originFromState,
} from "@/lib/catalogue/filters";
import { requestPlateFocus } from "@/lib/catalogue/plateFocus";
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
 * `/type/:slug` — the design type read as a style guide, with its own plates
 * beneath it. The guide comes from the design-type list the filter rail has
 * already fetched, so the route adds no request of its own.
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
      intro={
        <DesignTypeGuide designType={match} pending={designTypes.isPending} />
      }
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

/**
 * `/reference/:id` — the reference sheet raised over the catalogue it was
 * opened from. The catalogue renders behind the scrim, so the modal is layered
 * over the archive rather than replacing it, and the address stays shareable.
 */
export function ReferenceRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  // Which slice the plate was opened from; falls back to the whole archive for
  // a link pasted straight into the address bar.
  const origin = originFromState(location.state);

  /*
   * `key` is "default" only for the entry the app was loaded on, so this
   * distinguishes "opened from a plate" — where going back is what the reader
   * expects, and keeps Back and CLOSE symmetric — from a direct visit, where
   * there is no catalogue behind us in history to return to.
   */
  const openedFromCatalogue = location.key !== "default";

  const close = useCallback(() => {
    // Radix cannot restore focus across a route change, so hand it to the
    // plate explicitly; it claims this as it remounts behind the sheet.
    requestPlateFocus(id);
    if (openedFromCatalogue) {
      navigate(-1);
    } else {
      navigate(filterToPath(origin), { replace: true });
    }
  }, [id, navigate, openedFromCatalogue, origin]);

  return (
    <>
      <CatalogueView filter={origin} label={filterLabel(origin)} />
      <ReferenceModal referenceId={id} onClose={close} />
    </>
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
