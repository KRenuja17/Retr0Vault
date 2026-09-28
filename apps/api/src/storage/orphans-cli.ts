import { count } from "drizzle-orm";
import { openCliDatabase } from "../database/cli-connection.js";
import { references } from "../database/schema.js";
import { openBlobStore } from "./open-blob-store.js";
import { maintainOrphanFiles } from "./orphans.js";

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--quarantine") || args.length > 1) {
  throw new Error("Usage: npm run storage:orphans -- [--quarantine]");
}
const quarantine = args.includes("--quarantine");
const { config, connection } = await openCliDatabase();
try {
  // Never mistake an empty (not yet migrated) catalogue for a storage full of orphans.
  const [row] = await connection.database.select({ total: count() }).from(references);
  const total = row?.total ?? 0;
  if (quarantine && total === 0) throw new Error("The database has no references; refusing to quarantine storage");
  const blobs = openBlobStore(config);
  try {
    const report = await maintainOrphanFiles(connection.database, blobs, quarantine);
    process.stdout.write(`${JSON.stringify({ store: blobs.description, ...report }, null, 2)}\n`);
  } finally {
    blobs.close?.();
  }
} finally {
  await connection.close();
}
