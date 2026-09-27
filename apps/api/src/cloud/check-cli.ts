import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import postgres from "postgres";

/*
 * `npm run cloud:check` — Phase C, step C0.
 *
 * Confirms, from this PC, that the database and the file bucket named in the
 * repository's `.env` are reachable and usable: Postgres answers a query, and
 * the bucket accepts a small object, returns it (whole and by byte range, as
 * clip scrubbing will need) and deletes it again. Nothing else is touched.
 *
 * Secrets are never printed: only hosts, names and outcomes.
 */

const envPath = resolve(import.meta.dirname, "../../../../.env");
const required = ["DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;

type Outcome = { readonly step: string; readonly ok: boolean; readonly detail: string };

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Connection strings can appear in driver errors; keep the password out of the report.
  return message.replace(/:\/\/[^@\s]*@/gu, "://***@").slice(0, 240);
}

async function checkDatabase(url: string): Promise<Outcome[]> {
  const host = (() => { try { return new URL(url).host; } catch { return "(unparseable DATABASE_URL)"; } })();
  const sql = postgres(url, { ssl: "require", max: 1, connect_timeout: 15, prepare: false, onnotice: () => undefined });
  try {
    const [row] = await sql<{ version: string; user: string; db: string }[]>`
      select version() as version, current_user as user, current_database() as db`;
    const [tables] = await sql<{ count: string }[]>`
      select count(*)::text as count from information_schema.tables where table_schema = 'public'`;
    return [
      { step: "Postgres connection", ok: true, detail: `${host} as ${row!.user}, database ${row!.db}` },
      { step: "Postgres version", ok: true, detail: row!.version.split(" on ")[0]! },
      { step: "Public schema", ok: true, detail: `${tables!.count} existing tables (Retr0Vault will create its own in C1)` },
    ];
  } catch (error) {
    return [{ step: "Postgres connection", ok: false, detail: `${host}: ${describeError(error)}` }];
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

async function checkBucket(env: Record<(typeof required)[number], string>): Promise<Outcome[]> {
  const client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    forcePathStyle: true,
  });
  const key = `retr0vault-check/${randomUUID()}.txt`;
  const body = `retr0vault cloud check ${new Date().toISOString()}`;
  const results: Outcome[] = [];
  const target = `${new URL(env.S3_ENDPOINT).host} / ${env.S3_BUCKET}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: "text/plain" }));
    results.push({ step: "Bucket write", ok: true, detail: `${target}: wrote ${key}` });

    const head = await client.send(new HeadObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    results.push({ step: "Bucket metadata", ok: head.ContentLength === body.length, detail: `${head.ContentLength} bytes, ETag ${head.ETag}` });

    const whole = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
    const text = await whole.Body!.transformToString();
    results.push({ step: "Bucket read", ok: text === body, detail: text === body ? "content matches" : "content differs" });

    const ranged = await client.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: "bytes=0-9" }));
    const slice = await ranged.Body!.transformToString();
    results.push({ step: "Bucket byte range", ok: slice === body.slice(0, 10), detail: `${ranged.ContentRange ?? "no Content-Range"} → "${slice}"` });
  } catch (error) {
    results.push({ step: "Bucket", ok: false, detail: `${target}: ${describeError(error)}` });
  } finally {
    await client.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }))
      .then(() => results.push({ step: "Bucket delete", ok: true, detail: "test object removed" }))
      .catch((error: unknown) => results.push({ step: "Bucket delete", ok: false, detail: describeError(error) }));
    client.destroy();
  }
  return results;
}

async function main() {
  if (!existsSync(envPath)) {
    console.error(`No .env found at ${envPath}. Copy .env.example to .env and fill it in.`);
    process.exit(2);
  }
  process.loadEnvFile(envPath);
  const missing = required.filter((name) => !process.env[name]?.trim() || /\[YOUR-PASSWORD\]|PROJECTREF|REGION|your-bucket-name/u.test(process.env[name]!));
  if (missing.length > 0) {
    console.error(`Fill in these values in .env first: ${missing.join(", ")}`);
    process.exit(2);
  }
  const env = Object.fromEntries(required.map((name) => [name, process.env[name]!.trim()])) as Record<(typeof required)[number], string>;

  const outcomes = [...await checkDatabase(env.DATABASE_URL), ...await checkBucket(env)];
  for (const { step, ok, detail } of outcomes) console.log(`${ok ? "PASS" : "FAIL"}  ${step.padEnd(18)} ${detail}`);
  const failed = outcomes.filter((outcome) => !outcome.ok).length;
  console.log(failed === 0 ? "\nBoth services are ready for Phase C." : `\n${failed} check(s) failed.`);
  process.exit(failed === 0 ? 0 : 1);
}

void main();
