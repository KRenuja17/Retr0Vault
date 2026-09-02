import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { CollectionResponse } from "@retr0vault/shared";

import { SectionPanel } from "@/components/layout/SectionPanel";
import {
  ActionButton,
  ActionLink,
  CountLabel,
  MonoLabel,
  PageRule,
} from "@/components/primitives";
import { ApiError } from "@/lib/api/client";
import { useCollections } from "@/lib/catalogue/useCatalogue";
import {
  useCreateCollection,
  useDeleteCollection,
  useUpdateCollection,
} from "@/lib/collections/useCollectionActions";
import { cx } from "@/lib/cx";

import styles from "./CollectionIndex.module.css";

/** The backend's own limits, so a refusal is answered before the round trip. */
const NAME_LIMIT = 120;
const DESCRIPTION_LIMIT = 2_000;

function describeCollectionError(error: unknown, action: string): string {
  if (error instanceof ApiError && error.isOffline) {
    return `Retr0Vault could not reach the local API on 127.0.0.1:4611, so the collection was not ${action}. Start it with npm run dev:api.`;
  }
  if (error instanceof ApiError) {
    return error.message;
  }
  return `Something failed between the browser and the local API; the collection was not ${action}.`;
}

interface NameFieldsProps {
  readonly name: string;
  readonly description: string;
  readonly onName: (value: string) => void;
  readonly onDescription: (value: string) => void;
  readonly disabled: boolean;
  readonly nameError: string | null;
  readonly nameLabel: string;
  readonly autoFocus?: boolean;
}

/** The two fields a collection has. Shared by the create line and rename. */
function NameFields({
  name,
  description,
  onName,
  onDescription,
  disabled,
  nameError,
  nameLabel,
  autoFocus = false,
}: NameFieldsProps) {
  const nameId = useId();
  const descriptionId = useId();
  const errorId = `${nameId}-error`;

  return (
    <>
      <div className={styles.field}>
        <label htmlFor={nameId}>
          <MonoLabel size="small" uppercase>
            {nameLabel}
          </MonoLabel>
        </label>
        <input
          id={nameId}
          className={cx(styles.input, nameError && styles.inputInvalid)}
          value={name}
          maxLength={NAME_LIMIT}
          disabled={disabled}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? errorId : undefined}
          onChange={(event) => onName(event.target.value)}
        />
        {nameError ? (
          <MonoLabel id={errorId} size="micro" className={styles.error}>
            {nameError}
          </MonoLabel>
        ) : null}
      </div>

      <div className={styles.field}>
        <label htmlFor={descriptionId}>
          <MonoLabel size="small" uppercase>
            Description
          </MonoLabel>
        </label>
        <input
          id={descriptionId}
          className={styles.input}
          value={description}
          maxLength={DESCRIPTION_LIMIT}
          disabled={disabled}
          autoComplete="off"
          placeholder="Optional"
          onChange={(event) => onDescription(event.target.value)}
        />
      </div>
    </>
  );
}

function Notice({
  kind,
  children,
}: {
  readonly kind: "ok" | "failure";
  readonly children: ReactNode;
}) {
  return (
    <div
      className={cx(styles.notice, kind === "failure" && styles.noticeFailure)}
      role={kind === "failure" ? "alert" : "status"}
    >
      <p className={styles.noticeBody}>{children}</p>
    </div>
  );
}

/** Which inline editor, if any, one register row is showing. */
type RowMode = "idle" | "rename" | "confirm-delete";

function CollectionRow({
  collection,
  onNotice,
}: {
  readonly collection: CollectionResponse;
  readonly onNotice: (notice: { kind: "ok" | "failure"; text: string }) => void;
}) {
  const update = useUpdateCollection();
  const remove = useDeleteCollection();

  const [mode, setMode] = useState<RowMode>("idle");
  const [name, setName] = useState(collection.name);
  const [description, setDescription] = useState(collection.description);
  const [nameError, setNameError] = useState<string | null>(null);

  const busy = update.isPending || remove.isPending;

  function startRename() {
    setName(collection.name);
    setDescription(collection.description);
    setNameError(null);
    setMode("rename");
  }

  function saveRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("A collection needs a name.");
      return;
    }

    /*
     * The slug is deliberately left alone: it is the collection's address, and
     * renaming should not break a link someone has already followed or saved.
     */
    update.mutate(
      {
        id: collection.id,
        patch: { name: trimmed, description: description.trim() },
      },
      {
        onSuccess: (saved) => {
          setMode("idle");
          onNotice({ kind: "ok", text: `Renamed to ${saved.name}.` });
        },
        onError: (error) =>
          onNotice({
            kind: "failure",
            text: describeCollectionError(error, "renamed"),
          }),
      },
    );
  }

  function togglePin() {
    if (busy) return;
    update.mutate(
      { id: collection.id, patch: { isPinned: !collection.isPinned } },
      {
        onSuccess: (saved) =>
          onNotice({
            kind: "ok",
            text: saved.isPinned
              ? `${saved.name} is pinned to the filter rail.`
              : `${saved.name} is no longer pinned.`,
          }),
        onError: (error) =>
          onNotice({
            kind: "failure",
            text: describeCollectionError(error, "changed"),
          }),
      },
    );
  }

  function confirmDelete() {
    if (busy) return;
    remove.mutate(collection.id, {
      onSuccess: () => {
        setMode("idle");
        onNotice({
          kind: "ok",
          text: `${collection.name} was deleted. Its references are untouched and stay in the archive.`,
        });
      },
      onError: (error) =>
        onNotice({
          kind: "failure",
          text: describeCollectionError(error, "deleted"),
        }),
    });
  }

  return (
    <li className={styles.row}>
      <div className={styles.entry}>
        <Link to={`/collection/${collection.slug}`} className={styles.name}>
          {collection.name}
        </Link>
        <div className={styles.meta}>
          <MonoLabel size="small" tone="muted" uppercase>
            {`${collection.referenceCount} ${
              collection.referenceCount === 1 ? "reference" : "references"
            }`}
          </MonoLabel>
          {collection.isPinned ? (
            <MonoLabel
              size="micro"
              uppercase
              marker="solid"
              className={styles.pinned}
            >
              Pinned
            </MonoLabel>
          ) : null}
          <MonoLabel size="micro" tone="muted">
            {`/collection/${collection.slug}`}
          </MonoLabel>
        </div>
        {collection.description ? (
          <MonoLabel size="small" className={styles.description}>
            {collection.description}
          </MonoLabel>
        ) : null}
      </div>

      <div className={styles.actions}>
        <ActionLink
          variant="outline"
          size="small"
          to={`/collection/${collection.slug}`}
        >
          Open
        </ActionLink>
        <ActionButton
          variant="quiet"
          size="small"
          disabled={busy}
          onClick={() => (mode === "rename" ? setMode("idle") : startRename())}
        >
          Rename
        </ActionButton>
        <ActionButton
          variant="quiet"
          size="small"
          disabled={busy}
          onClick={togglePin}
          title={
            collection.isPinned
              ? "Remove this collection from the filter rail"
              : "Show this collection in the filter rail"
          }
        >
          {collection.isPinned ? "Unpin" : "Pin"}
        </ActionButton>
        <ActionButton
          variant="quiet"
          size="small"
          disabled={busy}
          onClick={() =>
            setMode(mode === "confirm-delete" ? "idle" : "confirm-delete")
          }
        >
          Delete
        </ActionButton>
      </div>

      {mode === "rename" ? (
        <form className={styles.inline} onSubmit={saveRename}>
          <NameFields
            nameLabel="Name"
            name={name}
            description={description}
            onName={(value) => {
              setName(value);
              setNameError(null);
            }}
            onDescription={setDescription}
            disabled={busy}
            nameError={nameError}
            autoFocus
          />
          <div className={styles.actions}>
            <ActionButton type="submit" variant="solid" size="small" disabled={busy}>
              {update.isPending ? "Saving" : "Save"}
            </ActionButton>
            <ActionButton
              variant="outline"
              size="small"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Cancel
            </ActionButton>
          </div>
        </form>
      ) : null}

      {mode === "confirm-delete" ? (
        /* Two steps rather than a browser confirm(), which blocks the page. */
        <div className={styles.confirm}>
          <MonoLabel size="small" uppercase marker="hollow">
            {`Delete ${collection.name}?`}
          </MonoLabel>
          <MonoLabel size="micro" tone="muted">
            The grouping goes; the references stay in the archive.
          </MonoLabel>
          <div className={styles.confirmActions}>
            <ActionButton
              variant="solid"
              size="small"
              disabled={busy}
              onClick={confirmDelete}
            >
              {remove.isPending ? "Deleting" : "Delete it"}
            </ActionButton>
            <ActionButton
              variant="outline"
              size="small"
              disabled={busy}
              onClick={() => setMode("idle")}
            >
              Keep
            </ActionButton>
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * `/collections` — the register of curated groupings.
 *
 * Collections are not design types: a design type describes a visual language
 * the archive recognises, a collection is whatever the curator decides to put
 * together. The two are never derived from one another.
 */
export function CollectionIndex() {
  const collections = useCollections();
  const create = useCreateCollection();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "failure";
    text: string;
  } | null>(null);

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;

    const trimmed = name.trim();
    if (trimmed.length === 0) {
      setNameError("A collection needs a name.");
      return;
    }

    create.mutate(
      // The slug is left to the backend, which derives it from the name.
      { name: trimmed, description: description.trim(), isPinned: false },
      {
        onSuccess: (created) => {
          setName("");
          setDescription("");
          setNotice({
            kind: "ok",
            text: `${created.name} was created at /collection/${created.slug}. Pin it to put it in the filter rail.`,
          });
        },
        onError: (error) =>
          setNotice({
            kind: "failure",
            text: describeCollectionError(error, "created"),
          }),
      },
    );
  }

  const items = collections.data ?? [];

  return (
    <div className={styles.view}>
      <SectionPanel
        eyebrow="Collection index"
        title="Curated groupings"
        marker
        lede="A collection is whatever you decide belongs together — a shortlist, a mood, a client's world. Design types describe a visual language the archive recognises; these do not, and the two are never mixed."
        aside={
          <MonoLabel size="small" tone="muted" uppercase marker="hollow">
            {collections.data ? `${items.length} collections` : "Reading register"}
          </MonoLabel>
        }
      >
        <form className={styles.create} onSubmit={submitCreate}>
          <NameFields
            nameLabel="New collection"
            name={name}
            description={description}
            onName={(value) => {
              setName(value);
              setNameError(null);
            }}
            onDescription={setDescription}
            disabled={create.isPending}
            nameError={nameError}
          />
          <ActionButton type="submit" variant="solid" disabled={create.isPending}>
            {create.isPending ? "Creating" : "Create"}
          </ActionButton>
        </form>
      </SectionPanel>

      {notice === null ? null : (
        <Notice kind={notice.kind}>{notice.text}</Notice>
      )}

      <div>
        <div className={styles.meta}>
          <MonoLabel size="small" tone="muted" uppercase>
            The register
          </MonoLabel>
          <MonoLabel size="micro" tone="muted" uppercase>
            Pinned collections lead the filter rail
          </MonoLabel>
        </div>
        <PageRule weight="hairline" space="tight" />

        {collections.isPending ? (
          <MonoLabel size="small" tone="muted" uppercase>
            Reading the register
          </MonoLabel>
        ) : collections.isError ? (
          <Notice kind="failure">
            {describeCollectionError(collections.error, "read")}
          </Notice>
        ) : items.length === 0 ? (
          <MonoLabel size="small" tone="muted" uppercase marker="hollow">
            No collections yet
          </MonoLabel>
        ) : (
          <ul className={styles.register} aria-label="Collection register">
            {items.map((collection) => (
              <CollectionRow
                key={collection.id}
                collection={collection}
                onNotice={setNotice}
              />
            ))}
          </ul>
        )}
      </div>

      <div className={styles.meta}>
        <CountLabel
          value={items.reduce((total, entry) => total + entry.referenceCount, 0)}
          tone="muted"
          size="small"
        />
        <MonoLabel size="micro" tone="muted" uppercase>
          memberships across all collections
        </MonoLabel>
      </div>
    </div>
  );
}
