import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { rowsOf, type Db } from "../database/connection.js";
import type { BlobListing, BlobStore } from "./blob-store.js";
import { motionFileNamePattern } from "./motion-storage.js";

export const orphanGracePeriodMs = 24 * 60 * 60 * 1_000;

export interface OrphanReport {
  mode: "report" | "quarantine";
  candidates: string[];
  quarantined: string[];
  /** Where quarantined files went, as a key prefix in the same store. */
  quarantinePrefix: string | null;
  skipped: Array<{ path: string; reason: string }>;
}

interface CatalogueSnapshot {
  references: Array<{ id: string; original_path: string; thumbnail_path: string }>;
  frames: Array<{ image_path: string }>;
  clips: Array<{ referenceId: string; clipId: string }>;
}

/** Every stored path the catalogue owns, read from one consistent snapshot. */
function readCatalogue(db: Db): Promise<CatalogueSnapshot> {
  return db.transaction(async (transaction) => ({
    references: rowsOf<CatalogueSnapshot["references"][number]>(
      await transaction.execute(sql`SELECT id::text AS id, original_path, thumbnail_path FROM "references"`),
    ),
    frames: rowsOf<CatalogueSnapshot["frames"][number]>(
      await transaction.execute(sql`SELECT image_path FROM reference_frames`),
    ),
    clips: rowsOf<CatalogueSnapshot["clips"][number]>(await transaction.execute(
      sql`SELECT s.reference_id::text AS "referenceId", c.id::text AS "clipId" FROM motion_clips c JOIN motion_studies s ON s.id = c.motion_study_id`,
    )),
  }), { isolationLevel: "repeatable read", accessMode: "read only" });
}

const isUuid = (value: string | undefined) => value !== undefined && z.uuid().safeParse(value).success;

/**
 * Which reference or clip a stored key would belong to, judged by its name
 * alone. Only names Retr0Vault itself creates are ever candidates.
 */
function classify(key: string): { id: string | undefined; known: boolean; clip?: string } | "ignore" {
  const parts = key.split("/");
  switch (parts[0]) {
    case "originals": {
      const match = /^([^/]+)\.(?:jpg|png|webp)$/u.exec(parts.slice(1).join("/"));
      return { id: match?.[1], known: match !== null && parts.length === 2 };
    }
    case "thumbnails": {
      const match = /^([^/]+)\.webp$/u.exec(parts.slice(1).join("/"));
      return { id: match?.[1], known: match !== null && parts.length === 2 };
    }
    case "captures":
      return { id: parts[1], known: parts.length === 3 && /^(?:viewport|hero|scroll-50|scroll-80|fullpage)\.png$/u.test(parts[2]!) };
    case "motion":
      if (parts.length === 2 && parts[1] === ".gitkeep") return "ignore";
      return {
        id: parts[2],
        known: parts.length === 4 && isUuid(parts[1]) && motionFileNamePattern.test(parts[3]!),
        clip: `${parts[1]}/${parts[2]}`.toLowerCase(),
      };
    default:
      return "ignore";
  }
}

/**
 * Stored files no database row owns: reported, and moved under a
 * `quarantine/<batch>/` prefix only when asked. Nothing is ever deleted
 * outright, recently written files are left alone (an upload or import may
 * still be finishing them), and names Retr0Vault did not create are only
 * reported.
 */
export async function maintainOrphanFiles(
  db: Db,
  blobs: BlobStore,
  quarantine = false,
): Promise<OrphanReport> {
  const report: OrphanReport = { mode: quarantine ? "quarantine" : "report", candidates: [], quarantined: [], quarantinePrefix: null, skipped: [] };
  const { references: rows, frames, clips } = await readCatalogue(db);
  const liveIds = new Set(rows.map((row) => row.id.toLowerCase()));
  const livePaths = new Set([...rows.flatMap((row) => [row.original_path, row.thumbnail_path]), ...frames.map((row) => row.image_path)]
    .map((path) => path.toLowerCase()));
  const liveClips = new Set(clips.map((row) => `${row.referenceId}/${row.clipId}`.toLowerCase()));
  const cutoff = Date.now() - orphanGracePeriodMs;

  const inspect = async (object: BlobListing): Promise<void> => {
    const kind = classify(object.key);
    if (kind === "ignore") return;
    // A motion file belongs to its clip; any other file to its reference, or to a row naming its path.
    const owned = kind.clip === undefined
      ? liveIds.has(kind.id?.toLowerCase() ?? "") || livePaths.has(object.key.toLowerCase())
      : liveClips.has(kind.clip);
    const reason = !kind.known || !isUuid(kind.id) ? "unrecognized filename" :
      owned ? "owned by a database reference" :
      object.lastModified.getTime() > cutoff ? "less than 24 hours old" : undefined;
    if (reason !== undefined) {
      report.skipped.push({ path: object.key, reason });
      return;
    }
    report.candidates.push(object.key);
    if (!quarantine) return;
    // Recheck immediately before moving.
    const current = await blobs.head(object.key);
    if (current === undefined || current.size !== object.size || current.lastModified.getTime() > cutoff) {
      throw new Error("Storage changed during maintenance; stop all writers and retry");
    }
    report.quarantinePrefix ??= `quarantine/${randomUUID()}/`;
    const destination = `${report.quarantinePrefix}${object.key}`;
    if (await blobs.head(destination) !== undefined) throw new Error("Quarantine destination already exists");
    await blobs.copy(object.key, destination);
    await blobs.delete(object.key);
    report.quarantined.push(object.key);
  };

  for (const prefix of ["originals/", "thumbnails/", "captures/", "motion/"]) {
    for await (const object of blobs.list(prefix)) await inspect(object);
  }
  return report;
}
