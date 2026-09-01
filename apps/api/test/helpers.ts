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
}

export async function createTestApp(label: string): Promise<TestAppContext> {
  const directory = mkdtempSync(join(tmpdir(), `retr0vault-${label}-`));
  const databasePath = join(directory, "test.db");
  const app = await buildApp({ databasePath, logger: false });
  return { app, databasePath, directory };
}

export async function disposeTestApp(context: TestAppContext): Promise<void> {
  await context.app.close();
  rmSync(context.directory, { force: true, recursive: true });
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
