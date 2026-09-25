import { useEffect, useId, useState, type FormEvent } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

import { SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  ActionLink,
  CatalogueGrid,
  FilterTab,
  MonoLabel,
  PageRule,
  padCount,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { cx } from "@/lib/cx";
import { isMotionTrigger, RAIL_TRIGGERS, TRIGGER_LABELS } from "@/lib/motion/format";
import { useScrubMode } from "@/lib/motion/preferences";
import { MOTION_PAGE_SIZE, useMotionList, useMotionTotals } from "@/lib/motion/useMotion";

import searchStyles from "@/components/catalogue/ArchiveSearch.module.css";
import viewStyles from "@/components/catalogue/CatalogueView.module.css";
import railStyles from "@/components/catalogue/FilterRail.module.css";

import { MotionCard } from "./MotionCard";
import styles from "./MotionView.module.css";

export const TRIGGER_PARAM = "trigger";
export const MOTION_QUERY_PARAM = "q";

/** The Motion section's own address for a trigger and search, for returning to. */
export function motionPath(trigger: string | null, query: string): string {
  const params = new URLSearchParams();
  if (trigger !== null) params.set(TRIGGER_PARAM, trigger);
  if (query.length > 0) params.set(MOTION_QUERY_PARAM, query);
  const search = params.toString();
  return search.length > 0 ? `/motion?${search}` : "/motion";
}

function MotionRail({ active, onScrub, scrub }: {
  readonly active: string | null;
  readonly scrub: boolean;
  readonly onScrub: (next: boolean) => void;
}) {
  const totals = useMotionTotals();
  const location = useLocation();
  const query = new URLSearchParams(location.search).get(MOTION_QUERY_PARAM) ?? "";
  const counts = new Map(totals.data?.countsByTrigger.map((entry) => [entry.trigger, entry.count]) ?? []);
  const triggers = (counts.get("unknown") ?? 0) > 0 ? [...RAIL_TRIGGERS, "unknown" as const] : RAIL_TRIGGERS;

  return (
    <nav className={railStyles.rail} aria-label="Motion filters">
      <div className={railStyles.tabs}>
        <FilterTab
          label="All motion"
          {...(totals.data ? { count: totals.data.total } : {})}
          to={motionPath(null, query)}
          active={active === null}
          matchRoute={false}
        />
        {triggers.map((trigger) => (
          <FilterTab
            key={trigger}
            label={TRIGGER_LABELS[trigger]}
            {...(totals.data ? { count: counts.get(trigger) ?? 0 } : {})}
            to={motionPath(trigger, query)}
            active={active === trigger}
            matchRoute={false}
            title={`Studies with a beat triggered by ${TRIGGER_LABELS[trigger].toLowerCase()}`}
          />
        ))}
        <span className={styles.scrub}>
          <FilterTab
            label={scrub ? "Scrub: on" : "Scrub: off"}
            active={scrub}
            onSelect={() => onScrub(!scrub)}
            title="Move the pointer across a plate to leaf through its recording instead of playing it"
          />
        </span>
      </div>
    </nav>
  );
}

function MotionSearch({ query, onSubmit }: { readonly query: string; readonly onSubmit: (next: string) => void }) {
  const [draft, setDraft] = useState(query);
  const inputId = useId();
  useEffect(() => setDraft(query), [query]);
  return (
    <form
      className={searchStyles.search}
      role="search"
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit(draft.trim());
      }}
    >
      <label htmlFor={inputId} className={searchStyles.label}>
        <MonoLabel size="small" uppercase>Search</MonoLabel>
      </label>
      <span className={searchStyles.entry}>
        <input
          id={inputId}
          className={searchStyles.input}
          type="search"
          value={draft}
          autoComplete="off"
          spellCheck={false}
          placeholder="wipe · pinned · camera push"
          onChange={(event) => setDraft(event.target.value)}
        />
      </span>
      <span className={searchStyles.actions}>
        <ActionButton type="submit" variant="solid" size="small">Find</ActionButton>
        {query.length > 0 ? (
          <ActionButton variant="quiet" size="small" onClick={() => { setDraft(""); onSubmit(""); }}>Clear</ActionButton>
        ) : null}
      </span>
      <MonoLabel size="micro" tone="muted" className={searchStyles.scope}>
        Matches title, motion DNA, techniques, beats, thesis, brief, inspection notes and verified tech.
      </MonoLabel>
    </form>
  );
}

function LoadingPlates() {
  return (
    <CatalogueGrid className={viewStyles.grid} aria-hidden="true">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={viewStyles.ghost}>
          <div className={viewStyles.ghostMedia} />
          <div className={viewStyles.ghostBody}>
            <div className={cx(viewStyles.ghostLine, viewStyles.ghostLineWide)} />
            <div className={viewStyles.ghostLine} />
          </div>
        </div>
      ))}
    </CatalogueGrid>
  );
}

/**
 * `/motion` — the archive's moving plates. The same page anatomy as the
 * catalogue: a rail (here by trigger), the index line, and the 3-column grid of
 * plates. A study appears here only when its reference has recordings; the
 * reference stays in the catalogue as well.
 */
export function MotionView({ address }: {
  /**
   * The Motion address to show when the page's own URL belongs to a sheet
   * (`/motion/:id?clip=…`): the trigger and search the sheet was opened from.
   */
  readonly address?: string;
} = {}) {
  const [ownParams, setSearchParams] = useSearchParams();
  const searchParams = address === undefined ? ownParams : new URL(address, "http://local").searchParams;
  const [scrub, setScrub] = useScrubMode();
  const rawTrigger = searchParams.get(TRIGGER_PARAM);
  const trigger = isMotionTrigger(rawTrigger) ? rawTrigger : null;
  const query = searchParams.get(MOTION_QUERY_PARAM) ?? "";
  const list = useMotionList({ trigger, query });
  const origin = motionPath(trigger, query);
  const label = trigger === null ? "All motion" : `${TRIGGER_LABELS[trigger]} motion`;

  const search = (next: string) => {
    setSearchParams((current) => {
      const params = new URLSearchParams(current);
      if (next.length > 0) params.set(MOTION_QUERY_PARAM, next);
      else params.delete(MOTION_QUERY_PARAM);
      return params;
    });
  };

  return (
    <div className={viewStyles.view}>
      <h1 className="rv-visually-hidden">Motion studies</h1>
      <MotionRail active={trigger} scrub={scrub} onScrub={setScrub} />
      <PageRule weight="hairline" />
      <MotionSearch query={query} onSubmit={search} />
      <PageRule weight="hairline" space="tight" />

      {list.isPending ? (
        <>
          <div className={viewStyles.ledger}>
            <MonoLabel size="small" tone="muted" uppercase>Reading motion studies</MonoLabel>
          </div>
          <LoadingPlates />
        </>
      ) : list.isError ? (
        <SectionPanel
          eyebrow="Motion unavailable"
          title={list.error instanceof ApiError && list.error.isOffline ? "The archive is not answering" : "The motion studies could not be read"}
          marker
          lede={list.error instanceof ApiError && !list.error.isOffline ? list.error.message
            : "Retr0Vault could not reach the local API on 127.0.0.1:4611. Start it with npm run dev:api and try again."}
        >
          <div className={viewStyles.stateActions}>
            <ActionButton variant="solid" onClick={() => void list.refetch()} disabled={list.isFetching}>
              {list.isFetching ? "Retrying" : "Retry"}
            </ActionButton>
          </div>
        </SectionPanel>
      ) : list.total === 0 ? (
        query.length > 0 || trigger !== null ? (
          <SectionPanel
            eyebrow="No matches"
            title="No motion study matches that"
            marker
            lede="Every word has to match somewhere on the same study. Clear the search or pick another trigger."
            aside={<MonoLabel size="small" tone="muted" uppercase marker="hollow">00 studies</MonoLabel>}
          >
            <div className={viewStyles.stateActions}>
              <ActionLink variant="solid" to="/motion">Show all motion</ActionLink>
            </div>
          </SectionPanel>
        ) : (
          <SectionPanel
            eyebrow="Motion studies"
            title="No recordings in the archive yet"
            marker
            lede="A motion study is a screen recording attached to a reference you already have. The reference keeps its design analysis in the catalogue; its recordings are studied here for how the site moves."
            aside={<MonoLabel size="small" tone="muted" uppercase marker="hollow">00 studies</MonoLabel>}
          >
            <div className={viewStyles.stateActions}>
              <ActionLink variant="solid" to="/add#motion">Add a recording</ActionLink>
              <ActionLink variant="outline" to="/all">Browse the catalogue</ActionLink>
            </div>
          </SectionPanel>
        )
      ) : (
        <>
          <div className={viewStyles.ledger} role="status">
            <MonoLabel size="small" tone="muted" uppercase>
              {query.length > 0 ? `${label} matching “${query}”` : label}
            </MonoLabel>
            <MonoLabel size="small" tone="muted" uppercase>
              {`Showing ${padCount(list.items.length, 2)} of ${padCount(list.total, 2)}`}
            </MonoLabel>
          </div>

          <CatalogueGrid className={viewStyles.grid}>
            {list.items.map((item) => (
              <MotionCard key={item.studyId} item={item} total={list.total} origin={origin} />
            ))}
          </CatalogueGrid>

          {list.hasNextPage ? (
            <>
              <PageRule weight="dotted" />
              <div className={viewStyles.more}>
                <ActionButton variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                  {list.isFetchingNextPage ? "Loading" : `Load next ${Math.min(MOTION_PAGE_SIZE, list.total - list.items.length)}`}
                </ActionButton>
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
