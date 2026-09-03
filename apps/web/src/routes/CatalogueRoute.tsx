import { useCallback } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { CollectionResponse } from "@retr0vault/shared";

import { SectionPanel } from "@/components/layout/SectionPanel";
import { CatalogueView } from "@/components/catalogue/CatalogueView";
import { DesignTypeGuide } from "@/components/design-type/DesignTypeGuide";
import { ReferenceModal } from "@/components/reference/ReferenceModal";
import {
  filterLabel,
  filterToPath,
  originFromState,
} from "@/lib/catalogue/filters";
import { clearPlateFocus, requestPlateFocus } from "@/lib/catalogue/plateFocus";
import { ActionLink, MonoLabel } from "@/components/primitives";
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
      introHeading={match !== undefined}
      intro={
        <DesignTypeGuide designType={match} pending={designTypes.isPending} />
      }
    />
  );
}

/**
 * `/collection/:slug` — the catalogue filtered to one collection, under a
 * compact header. Managing the collection itself lives in the register at
 * `/collections`, so this route stays a way of reading the archive.
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
      introHeading={match !== undefined}
      intro={
        <CollectionHeader collection={match} pending={collections.isPending} />
      }
    />
  );
}

/** The plate above a collection's plates: what it is, how big, where to edit it. */
function CollectionHeader({
  collection,
  pending,
}: {
  readonly collection: CollectionResponse | undefined;
  readonly pending: boolean;
}) {
  if (pending || collection === undefined) {
    return null;
  }

  return (
    <SectionPanel
      eyebrow="Collection"
      title={collection.name}
      level={1}
      marker
      {...(collection.description
        ? { lede: collection.description }
        : {
            lede: "A curated grouping. Add or remove references from any reference sheet.",
          })}
      aside={
        <MonoLabel size="small" tone="muted" uppercase marker={collection.isPinned ? "solid" : "hollow"}>
          {`${collection.referenceCount} ${
            collection.referenceCount === 1 ? "reference" : "references"
          }${collection.isPinned ? " · pinned" : ""}`}
        </MonoLabel>
      }
    >
      <ActionLink variant="outline" size="small" to="/collections">
        Manage collections
      </ActionLink>
    </SectionPanel>
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

  /*
   * Leaving the sheet, whether it was closed or the reference was removed, is
   * the same navigation: back to the entry it was opened from, so the reader
   * lands on the exact slice, search and scroll position they left — and a
   * direct visit, which has no catalogue behind it in history, is sent to the
   * slice the address named instead.
   */
  const returnToCatalogue = useCallback(() => {
    if (openedFromCatalogue) {
      navigate(-1);
    } else {
      navigate(filterToPath(origin), { replace: true });
    }
  }, [navigate, openedFromCatalogue, origin]);

  const close = useCallback(() => {
    // Radix cannot restore focus across a route change, so hand it to the
    // plate explicitly; it claims this as it remounts behind the sheet.
    requestPlateFocus(id);
    returnToCatalogue();
  }, [id, returnToCatalogue]);

  const deleted = useCallback(() => {
    // There is no plate left to hand focus back to; make sure nothing is
    // waiting to claim it either.
    clearPlateFocus();
    returnToCatalogue();
  }, [returnToCatalogue]);

  return (
    <>
      <CatalogueView filter={origin} label={filterLabel(origin)} />
      <ReferenceModal referenceId={id} onClose={close} onDeleted={deleted} />
    </>
  );
}

/** Anything else. */
export function NotFoundRoute() {
  return (
    <SectionPanel
      eyebrow="404"
      title="No such plate"
      level={1}
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route not found
        </MonoLabel>
      }
      lede="That address is not part of the archive. The catalogue is at /all."
    />
  );
}
