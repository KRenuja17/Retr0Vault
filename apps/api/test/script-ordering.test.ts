import { spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));

describe("backend npm build ordering", () => {
  let directory: string;
  let links: string[];

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "retr0vault-script-ordering-"));
    links = [];
    // Copy only source/configuration: no dist or build-info can mask a missing prerequisite.
    for (const path of [
      "package.json", "tsconfig.base.json", "tsconfig.typecheck.json",
      "apps/api/package.json", "apps/api/tsconfig.json", "apps/api/src", "apps/api/drizzle",
      "packages/shared/package.json", "packages/shared/tsconfig.json", "packages/shared/src",
    ]) {
      const target = join(directory, path);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(repositoryRoot, path), target, { recursive: true });
    }
    // Reuse installed tools without another install. Override the shared workspace link
    // nearest the copied API so an existing build in the real checkout cannot satisfy it.
    for (const [source, target] of [
      [join(repositoryRoot, "node_modules"), join(directory, "node_modules")],
      [join(directory, "packages/shared"), join(directory, "apps/api/node_modules/@retr0vault/shared")],
    ] as const) {
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(source, target, process.platform === "win32" ? "junction" : "dir");
      links.push(target);
    }
    expect(existsSync(join(directory, "packages/shared/dist"))).toBe(false);
    expect(existsSync(join(directory, "apps/api/dist"))).toBe(false);
  });

  afterEach(() => {
    // Unlink borrowed dependencies before removing this test's private workspace.
    for (const link of links.reverse()) unlinkSync(link);
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  function runNpm(...args: string[]) {
    const npmCli = process.env["npm_execpath"];
    const result = spawnSync(
      npmCli === undefined ? (process.platform === "win32" ? "npm.cmd" : "npm") : process.execPath,
      npmCli === undefined ? args : [npmCli, ...args],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          DATABASE_PATH: join(directory, "runtime/library.db"),
          STORAGE_ROOT: join(directory, "runtime/storage"),
          ANALYSIS_DATA_DIR: join(directory, "runtime/analysis"),
        },
        shell: npmCli === undefined && process.platform === "win32",
        windowsHide: true,
        timeout: 45_000,
      },
    );
    expect(result.error).toBeUndefined();
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  }

  it("builds shared before root seed, including repeat runs", () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = runNpm("run", "seed");
      expect(result.status, result.output).toBe(0);
      expect(result.output).toContain("Seeded 7 design types and 1 collections");
      expect(existsSync(join(directory, "packages/shared/dist/index.js"))).toBe(true);
      expect(existsSync(join(directory, "runtime/library.db"))).toBe(true);
    }
  }, 60_000);

  it("builds shared before seed:clear invoked directly in the API workspace", () => {
    const result = runNpm("run", "seed:clear", "--workspace", "@retr0vault/api");
    expect(result.status, result.output).toBe(0);
    expect(result.output).toContain("Removed 0 design types and 0 collections");
    expect(existsSync(join(directory, "packages/shared/dist/index.js"))).toBe(true);
  }, 60_000);

  it.each(["seed", "seed:clear"])("does not run %s if the shared build fails", (command) => {
    writeFileSync(join(directory, "packages/shared/src/build-failure.ts"), "export const invalid: string = 1;\n");
    const result = runNpm("run", command);
    expect(result.status, result.output).not.toBe(0);
    expect(result.output).toContain("error TS2322");
    expect(existsSync(join(directory, "runtime/library.db"))).toBe(false);
  }, 60_000);

  it.each([
    ["typecheck", "packages/shared/dist/index.d.ts"],
    ["prestart", "apps/api/dist/server.js"],
  ])("builds prerequisites for the API workspace %s", (command, outputPath) => {
    const result = runNpm("run", command, "--workspace", "@retr0vault/api");
    expect(result.status, result.output).toBe(0);
    expect(existsSync(join(directory, "packages/shared/dist/index.js"))).toBe(true);
    expect(existsSync(join(directory, outputPath))).toBe(true);
    expect(existsSync(join(directory, "runtime/library.db"))).toBe(false);
  }, 60_000);
});
