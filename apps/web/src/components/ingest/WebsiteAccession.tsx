import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";

import {
  ActionButton,
  EditorialHeading,
  MonoLabel,
} from "@/components/primitives";
import { useDesignTypes } from "@/lib/catalogue/useCatalogue";
import { useWebsiteAccession } from "@/lib/ingest/useIngest";
import { validateCaptureUrl } from "@/lib/ingest/validation";

import { AccessionOutcome } from "./AccessionOutcome";
import { CheckField, SelectField, TextField } from "./Field";
import styles from "./Ingest.module.css";

/** The API's own capture ceiling, so the ruler below fills at the real rate. */
const CAPTURE_BUDGET_SECONDS = 45;
const PROGRESS_TICKS = 30;

function CaptureProgress({ elapsed }: { readonly elapsed: number }) {
  const filled = Math.min(
    PROGRESS_TICKS,
    Math.round((elapsed / CAPTURE_BUDGET_SECONDS) * PROGRESS_TICKS),
  );

  return (
    <div className={styles.progress} role="status">
      <div className={styles.progressHead}>
        <MonoLabel size="small" tone="inverse" uppercase marker="hollow">
          Capturing
        </MonoLabel>
        <MonoLabel size="small" tone="inverse" uppercase>
          {`${String(elapsed).padStart(2, "0")}s of ${CAPTURE_BUDGET_SECONDS}s`}
        </MonoLabel>
      </div>
      <div className={styles.progressTicks} aria-hidden="true">
        {Array.from({ length: PROGRESS_TICKS }, (_, index) => (
          <span
            key={index}
            className={
              index < filled
                ? `${styles.progressTick} ${styles.progressTickFilled}`
                : styles.progressTick
            }
          />
        ))}
      </div>
      <MonoLabel size="micro" tone="inverse">
        Chromium is opening the page and taking the viewport, hero and scroll
        frames. Leave this page open until it finishes.
      </MonoLabel>
    </div>
  );
}

/**
 * The website lane: one address in, a local Playwright capture out. The
 * request runs for as long as the capture does, so the wait is given a visible
 * budget rather than an indefinite spinner.
 */
export function WebsiteAccession() {
  const designTypes = useDesignTypes();
  const accession = useWebsiteAccession();

  const [url, setUrl] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [designTypeId, setDesignTypeId] = useState("");
  const [fullPage, setFullPage] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const headingId = useId();
  const capturing = accession.isPending;

  useEffect(() => {
    if (!capturing) return undefined;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.round((Date.now() - started) / 1_000)),
      1_000,
    );
    return () => clearInterval(timer);
  }, [capturing]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Only one capture runs at a time in the backend; do not queue a second.
    if (capturing) return;

    const problem = validateCaptureUrl(url);
    setUrlError(problem);
    if (problem !== null) return;

    accession.mutate(
      {
        url: url.trim(),
        title: title.trim() === "" ? undefined : title.trim(),
        designTypeId: designTypeId === "" ? undefined : designTypeId,
        fullPage,
      },
      {
        onSuccess: () => {
          setUrl("");
          setTitle("");
          setDesignTypeId("");
          setFullPage(false);
        },
      },
    );
  }

  const designTypeOptions = (designTypes.data ?? []).map((designType) => ({
    value: designType.id,
    label: designType.name,
  }));

  return (
    <section className={styles.lane} aria-labelledby={headingId}>
      <header className={styles.laneHead}>
        <MonoLabel size="small" uppercase marker="square">
          Website capture
        </MonoLabel>
        <EditorialHeading level={2} scale="section" id={headingId}>
          Capture a public page
        </EditorialHeading>
        <p className={styles.laneNote}>
          A local headless Chromium opens the address and stores the viewport,
          hero and two scroll frames. Public http(s) addresses on their standard
          port only.
        </p>
      </header>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextField
          label="Address"
          note="Required"
          type="url"
          value={url}
          onChange={(value) => {
            setUrl(value);
            setUrlError(null);
          }}
          placeholder="https://example.com"
          disabled={capturing}
          error={urlError ?? undefined}
        />

        <div className={styles.formGrid}>
          <TextField
            label="Title"
            note="Optional"
            value={title}
            onChange={setTitle}
            placeholder="The site's hostname"
            disabled={capturing}
            hint="Left blank, the hostname is used."
          />
          <SelectField
            label="Design type"
            note="Optional"
            value={designTypeId}
            onChange={setDesignTypeId}
            options={designTypeOptions}
            placeholderOption="Unassigned — set by analysis"
            disabled={capturing || designTypes.isPending}
          />
        </div>

        <CheckField
          label="Also capture the full page"
          checked={fullPage}
          onChange={setFullPage}
          disabled={capturing}
          hint="Adds one tall frame. Refused above 4096 × 20000 pixels."
        />

        {capturing ? <CaptureProgress elapsed={elapsed} /> : null}

        <div className={styles.actions}>
          <ActionButton type="submit" variant="solid" disabled={capturing}>
            {capturing ? "Capturing" : "Capture this site"}
          </ActionButton>
          <MonoLabel size="micro" tone="muted" uppercase className={styles.actionsNote}>
            {capturing
              ? "One capture runs at a time"
              : "Files as awaiting analysis"}
          </MonoLabel>
        </div>
      </form>

      <AccessionOutcome
        subject="capture"
        reference={accession.data}
        error={accession.isError ? accession.error : undefined}
        onDismiss={() => accession.reset()}
      />
    </section>
  );
}
