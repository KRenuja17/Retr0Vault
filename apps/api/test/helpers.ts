import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FastifyInstance } from "fastify";

import type { CreateDesignTypeInput } from "@retr0vault/shared";

import { buildApp } from "../src/app.js";

export interface TestAppContext {
  readonly app: FastifyInstance;
  readonly databasePath: string;
  readonly directory: string;
  readonly storageRoot: string;
}

export async function createTestApp(
  label: string,
  options: { readonly maxUploadBytes?: number } = {},
): Promise<TestAppContext> {
  const directory = mkdtempSync(join(tmpdir(), `retr0vault-${label}-`));
  const databasePath = join(directory, "test.db");
  const storageRoot = join(directory, "storage");
  const app = await buildApp({
    databasePath,
    storageRoot,
    logger: false,
    ...(options.maxUploadBytes === undefined
      ? {}
      : { maxUploadBytes: options.maxUploadBytes }),
  });
  return { app, databasePath, directory, storageRoot };
}

export async function disposeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
  rmSync(context.directory, {
    force: true,
    maxRetries: 5,
    recursive: true,
    retryDelay: 50,
  });
}

export const validDesignTypeInput: CreateDesignTypeInput = {
  name: "Editorial Signal",
  slug: "editorial-signal",
  description: "Editorial hierarchy organized around a clear visual signal.",
  deployFor: "Studios and publications.",
  risk: "Excessive annotation can overpower the main content.",
  briefBlock: "Use a disciplined editorial grid with one signal accent.",
  principles: ["Lead with a clear editorial hierarchy"],
  avoid: ["Avoid decorative metadata without purpose"],
  vocabulary: ["editorial grid", "signal accent"],
};

interface MultipartPayloadOptions {
  readonly fields?: Readonly<Record<string, string>>;
  readonly file?: {
    readonly buffer: Buffer;
    readonly filename?: string;
    readonly fieldname?: string;
    readonly contentType?: string;
  };
}

export function createMultipartPayload(options: MultipartPayloadOptions): {
  readonly headers: Record<string, string>;
  readonly payload: Buffer;
} {
  const boundary = `retr0vault-test-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks: Buffer[] = [];
  const append = (value: string) => chunks.push(Buffer.from(value, "utf8"));

  for (const [name, value] of Object.entries(options.fields ?? {})) {
    append(`--${boundary}\r\n`);
    append(`Content-Disposition: form-data; name="${name}"\r\n\r\n`);
    append(`${value}\r\n`);
  }

  if (options.file !== undefined) {
    const filename = (options.file.filename ?? "reference.png").replaceAll(
      '"',
      "",
    );
    append(`--${boundary}\r\n`);
    append(
      `Content-Disposition: form-data; name="${options.file.fieldname ?? "file"}"; filename="${filename}"\r\n`,
    );
    append(
      `Content-Type: ${options.file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    );
    chunks.push(options.file.buffer);
    append("\r\n");
  }

  append(`--${boundary}--\r\n`);

  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(chunks),
  };
}
