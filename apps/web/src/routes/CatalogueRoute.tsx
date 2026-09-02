import { useParams } from "react-router-dom";

import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import { MonoLabel } from "@/components/primitives";

const CATALOGUE_MANIFEST = [
  "Design-type filter rail with live counts",
  "Three-column catalogue grid",
  "Screenshot-first plates",
  "Design DNA opposite each title",
  "Vocabulary chips with +N overflow",
  "Catalogue numbering",
];

/** `/all` — the main catalogue. The grid itself is built in the next phase. */
export function AllRoute() {
  return (
    <SectionPanel
      eyebrow="Catalogue"
      title="The full archive"
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route · /all
        </MonoLabel>
      }
      lede="Every reference in Retr0Vault, ordered as a catalogue rather than a feed. The visual system and route shell are in place; the plates land next."
    >
      <ManifestList label="Next in this view" items={CATALOGUE_MANIFEST} />
    </SectionPanel>
  );
}

/** `/type/:slug` — a design type read as a mini style guide, then its plates. */
export function DesignTypeRoute() {
  const { slug = "" } = useParams<{ slug: string }>();

  return (
    <SectionPanel
      eyebrow="Design type"
      title={slug || "Unknown type"}
      marker
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route · /type/{slug}
        </MonoLabel>
      }
      lede="A design type is a style guide, not a filter label: description, deploy-for, risk, principles, anti-patterns and reusable vocabulary, with its own plates beneath."
    >
      <ManifestList
        label="Next in this view"
        items={[
          "Description and DEPLOY FOR line",
          "RISK statement as marginalia",
          "Vocabulary chip set",
          "Principles and AVOID columns",
          "COPY BRIEF BLOCK / COPY VOCAB ONLY",
          "Filtered catalogue plates",
        ]}
      />
    </SectionPanel>
  );
}

/** `/collection/:slug` — pinned and user collections, same plate language. */
export function CollectionRoute() {
  const { slug = "" } = useParams<{ slug: string }>();

  return (
    <SectionPanel
      eyebrow="Collection"
      title={slug || "Unknown collection"}
      aside={
        <MonoLabel size="small" tone="muted" uppercase>
          Route · /collection/{slug}
        </MonoLabel>
      }
      lede="Collections are ordinary records, not hard-coded categories. Reference Styles ships pinned; further collections are created from the archive itself."
    >
      <ManifestList
        label="Next in this view"
        items={[
          "Pinned collections in the filter rail",
          "Collection plates",
          "Add and remove membership",
          "Rename, pin and delete",
        ]}
      />
    </SectionPanel>
  );
}

/** `/reference/:id` — route-backed modal state for a single reference. */
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
      lede="Opening a plate raises the large detail modal over a darkened catalogue. This route exists so a reference stays linkable and survives a reload."
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
