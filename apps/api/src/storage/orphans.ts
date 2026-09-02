import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { z } from "zod";
import type { DatabaseConnection } from "../database/connection.js";

export const orphanGracePeriodMs = 24 * 60 * 60 * 1_000;

export interface OrphanReport {
  mode: "report" | "quarantine";
  candidates: string[];
  quarantined: string[];
  quarantineDirectory: string | null;
  skipped: Array<{ path: string; reason: string }>;
}

function statIfPresent(path: string) {
  try { return lstatSync(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}

function safeDirectory(root: string, directory: string, create = false): void {
  const path = relative(root, directory);
  if (isAbsolute(path) || path.split(/[\\/]/u).includes("..")) throw new Error("Unsafe maintenance directory");
  let current = root;
  for (const part of ["", ...path.split(/[\\/]/u).filter(Boolean)]) {
    current = resolve(current, part);
    if (create && !statIfPresent(current)) mkdirSync(current);
    const entry = lstatSync(current);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error("Maintenance directories must not be links");
  }
}

export function maintainOrphanFiles(
  connection: DatabaseConnection,
  storageRoot: string,
  quarantine = false,
): OrphanReport {
  const root = resolve(storageRoot);
  const report: OrphanReport = { mode: quarantine ? "quarantine" : "report", candidates: [], quarantined: [], quarantineDirectory: null, skipped: [] };
  // An exclusive writer reservation protects the DB snapshot during the moves.
  // Stop API/import processes first: SQLite cannot lock their in-flight file writes.
  return connection.sqlite.transaction(() => {
    const integrity = connection.sqlite.pragma("quick_check") as Array<{ quick_check: string }>;
    if (integrity.some((row) => row.quick_check !== "ok") || (connection.sqlite.pragma("foreign_key_check") as unknown[]).length > 0) {
      throw new Error("Database integrity check failed; storage was not touched");
    }
    const rows = connection.sqlite.prepare('SELECT id, original_path, thumbnail_path FROM "references"').all() as Array<{ id: string; original_path: string; thumbnail_path: string }>;
    const frames = connection.sqlite.prepare("SELECT image_path FROM reference_frames").all() as Array<{ image_path: string }>;
    const liveIds = new Set(rows.map((row) => row.id.toLowerCase()));
    const livePaths = new Set([...rows.flatMap((row) => [row.original_path, row.thumbnail_path]), ...frames.map((row) => row.image_path)]
      .map((path) => resolve(root, path).toLowerCase()));
    if (!statIfPresent(root)) return report;
    safeDirectory(root, root);
    const cutoff = Date.now() - orphanGracePeriodMs;
    const inspect = (path: string, id: string | undefined, known: boolean) => {
      const absolute = resolve(root, path);
      const entry = lstatSync(absolute);
      const reason = entry.isSymbolicLink() || !entry.isFile() ? "not a regular file" :
        !known || !z.uuid().safeParse(id).success ? "unrecognized filename" :
        liveIds.has(id!.toLowerCase()) || livePaths.has(absolute.toLowerCase()) ? "owned by a database reference" :
        entry.mtimeMs > cutoff ? "less than 24 hours old" : undefined;
      if (reason) { report.skipped.push({ path, reason }); return; }
      report.candidates.push(path);
      if (!quarantine) return;
      // Recheck immediately before moving; never follow directory links.
      safeDirectory(root, dirname(absolute));
      const current = lstatSync(absolute);
      if (!current.isFile() || current.isSymbolicLink() || current.ino !== entry.ino || current.dev !== entry.dev ||
          current.mtimeMs !== entry.mtimeMs || current.size !== entry.size) throw new Error("Storage changed during maintenance; stop all writers and retry");
      if (!report.quarantineDirectory) {
        safeDirectory(root, resolve(root, "quarantine"), true);
        const batch = resolve(root, "quarantine", randomUUID());
        mkdirSync(batch); // Exclusive new batch: existing content is never overwritten.
        report.quarantineDirectory = batch;
      }
      const destination = resolve(report.quarantineDirectory, path);
      safeDirectory(root, dirname(destination), true);
      if (statIfPresent(destination)) throw new Error("Quarantine destination already exists");
      renameSync(absolute, destination);
      report.quarantined.push(path);
    };
    for (const kind of ["originals", "thumbnails", "captures"] as const) {
      const directory = resolve(root, kind);
      if (!statIfPresent(directory)) continue;
      safeDirectory(root, directory);
      for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
        if (kind === "captures" && entry.isDirectory() && !entry.isSymbolicLink() && z.uuid().safeParse(entry.name).success) {
          const captureDirectory = resolve(directory, entry.name);
          safeDirectory(root, captureDirectory);
          for (const frame of readdirSync(captureDirectory).sort()) {
            inspect(`${kind}/${entry.name}/${frame}`, entry.name, /^(viewport|hero|scroll-50|scroll-80|fullpage)\.png$/u.test(frame));
          }
        } else {
          const match = /^(.*)\.(jpg|png|webp)$/u.exec(entry.name);
          inspect(`${kind}/${entry.name}`, match?.[1], kind === "originals" ? !!match : kind === "thumbnails" && match?.[2] === "webp");
        }
      }
    }
    return report;
  }).immediate();
}
