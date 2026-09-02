import { ManifestList, SectionPanel } from "@/components/layout/SectionPanel";
import { MonoLabel, PageRule } from "@/components/primitives";

import { AnalysisDesk } from "./AnalysisDesk";
import { ImageAccession } from "./ImageAccession";
import { WebsiteAccession } from "./WebsiteAccession";
import styles from "./Ingest.module.css";

/**
 * `/add` — accession and the analysis desk on one page.
 *
 * Everything here is local: a file copied into storage, or a page captured by
 * a headless browser on this machine. No reference is sent to any service, and
 * no analysis is generated here — that loop runs through an exported manifest
 * and the JSON a coding agent writes back.
 */
export function AddReferenceView() {
  return (
    <div className={styles.view}>
      <SectionPanel
        eyebrow="Accession"
        title="Add a reference to the archive"
        marker
        lede="A new reference is stored on this machine and filed as awaiting analysis. Design DNA, vocabulary, brief and image recipe arrive later, when the exported manifest comes back as analysis JSON."
        aside={
          <MonoLabel size="small" tone="muted" uppercase marker="hollow">
            Local ingest · no AI keys
          </MonoLabel>
        }
      >
        <ManifestList
          label="The curator loop"
          items={[
            "File an image or capture a site",
            "The reference is filed as pending",
            "Export the pending manifest",
            "Claude Code or Codex writes the analysis",
            "Import the JSON it produced",
          ]}
        />
      </SectionPanel>

      <div className={styles.lanes}>
        <ImageAccession />
        <WebsiteAccession />
      </div>

      <PageRule weight="heavy" />

      <AnalysisDesk />
    </div>
  );
}
