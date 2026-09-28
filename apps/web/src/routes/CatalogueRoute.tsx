import { useCallback, useRef } from "react";
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
import {
  backdropPath,
  sheetStackFromState,
  SheetStackProvider,
  type SheetStack,
} from "@/lib/navigation/sheetStack";
import { MotionView } from "@/components/motion/MotionView";
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
 * opened from (or over the Motion grid, when the reader turned to it from a
 * motion study opened there). The page renders behind the scrim, so the modal
 * is layered over the archive rather than replacing it, and the address stays
 * shareable.
 */
export function ReferenceRoute() {
  const { id = "" } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();

  /*
   * Opened from a plate: the slice it came from is behind the sheet, one step
   * back in history. `key` is "default" only for the entry the app was loaded
   * on, so a direct visit has no catalogue behind it; it falls back to the
   * slice the state names, or the whole archive. Turned to from the motion
   * study, the sheet inherits that study's stack instead.
   */
  const arrival = useRef<SheetStack>({
    backdrop: { kind: "catalogue", filter: originFromState(location.state) },
    inHistory: location.key !== "default",
  }).current;
  const stack = sheetStackFromState(location.state) ?? arrival;

  /*
   * Leaving the sheet, whether it was closed or the reference was removed, is
   * the same navigation: back to the entry it was opened from, so the reader
   * lands on the exact slice, search and scroll position they left — and a
   * direct visit, which has nothing behind it in history, is sent to the page
   * the stack names instead.
   */
  const returnToCatalogue = useCallback(() => {
    if (stack.inHistory) {
      navigate(-1);
    } else {
      navigate(backdropPath(stack.backdrop), { replace: true });
    }
  }, [navigate, stack]);

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
    <SheetStackProvider value={stack}>
      {stack.backdrop.kind === "catalogue" ? (
        <CatalogueView filter={stack.backdrop.filter} label={filterLabel(stack.backdrop.filter)} />
      ) : (
        <MotionView address={stack.backdrop.path} />
      )}
      <ReferenceModal referenceId={id} onClose={close} onDeleted={deleted} />
    </SheetStackProvider>
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
