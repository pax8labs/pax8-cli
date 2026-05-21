// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  resolve as resolvePath,
  sep as pathSep,
  join as joinPath,
} from "node:path";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolveCliPath, tokenize } from "./repl.js";

describe("resolveCliPath", () => {
  // Regression: previous logic used `import.meta.url`-based resolution and
  // landed on `packages/cli/index.js` (a file that doesn't exist) at runtime
  // because tsup inlines lib/repl.ts into dist/index.js. Every command typed
  // at the `pax8>` prompt then crashed with MODULE_NOT_FOUND for global
  // installs.
  //
  // Tests are written cross-platform: build inputs with the platform's
  // resolver (path.resolve) so Windows CI doesn't fail just because
  // POSIX-style absolute strings are interpreted as drive-relative.

  it("preserves an absolute path verbatim (idempotent)", () => {
    const input = resolvePath("dist", "index.js"); // platform-correct absolute
    expect(resolveCliPath(input)).toBe(input);
  });

  it("never strips the dist/ segment (the actual regression)", () => {
    const input = resolvePath("packages", "cli", "dist", "index.js");
    const result = resolveCliPath(input);
    expect(result).toContain(`${pathSep}dist${pathSep}`);
  });

  it("throws when process.argv[1] is empty (cannot determine entry)", () => {
    expect(() => resolveCliPath("")).toThrow(/cannot determine CLI entry/);
    expect(() => resolveCliPath(undefined)).toThrow(/cannot determine CLI entry/);
  });

  // Production install layouts — exercise the two paths the helper actually
  // gets fed at runtime when a partner has run `npm install -g` or
  // `pnpm install -g`. The dist-path case above only covers the dev/source
  // tree.

  describe("production install layouts", () => {
    let tmpRoot: string;

    beforeAll(() => {
      tmpRoot = mkdtempSync(joinPath(tmpdir(), "pax8-resolve-cli-path-"));
    });

    afterAll(() => {
      rmSync(tmpRoot, { recursive: true, force: true });
    });

    it("npm install -g layout: returns the bin symlink path Node was invoked with", () => {
      // npm install -g lays down /usr/local/bin/pax8 as a symlink to the
      // real dist/index.js inside the global node_modules tree. Node sets
      // process.argv[1] to the symlink path (NOT the dereferenced target),
      // and child spawn with that path works because Node resolves the
      // symlink before evaluating module paths. The helper must pass that
      // path through unchanged.
      const realDir = joinPath(tmpRoot, "npm-real", "node_modules", "@pax8", "cli", "dist");
      const binDir = joinPath(tmpRoot, "npm-bin");
      mkdirSync(realDir, { recursive: true });
      mkdirSync(binDir, { recursive: true });
      const realFile = joinPath(realDir, "index.js");
      const linkPath = joinPath(binDir, "pax8");
      writeFileSync(realFile, "// real entry\n");
      symlinkSync(realFile, linkPath);

      // process.argv[1] under npm-global = the symlink path.
      expect(resolveCliPath(linkPath)).toBe(linkPath);
    });

    it("pnpm install -g layout: returns the resolved dist path the sh shim execs", () => {
      // pnpm install -g lays down an sh shim (NOT a JS shim or symlink) at
      // ~/Library/pnpm/pax8 that ends with
      //   exec node "$basedir/global/5/.pnpm/<pkg>/node_modules/@pax8/cli/dist/index.js" "$@"
      // So when a partner types `pax8`, Node sees process.argv[1] = that
      // resolved real path inside the .pnpm/ virtual store, NOT the shim
      // path. The helper must preserve that path (with its .pnpm/ segment
      // and trailing /dist/index.js) so REPL child-spawn can re-invoke it.
      const pnpmDist = joinPath(
        tmpRoot,
        ".pnpm",
        "@pax8+cli@0.1.0",
        "node_modules",
        "@pax8",
        "cli",
        "dist",
      );
      mkdirSync(pnpmDist, { recursive: true });
      const distFile = joinPath(pnpmDist, "index.js");
      writeFileSync(distFile, "// pnpm-installed entry\n");

      const result = resolveCliPath(distFile);
      expect(result).toBe(distFile);
      expect(result).toContain(`${pathSep}.pnpm${pathSep}`);
      expect(result).toContain(`${pathSep}dist${pathSep}`);
    });
  });
});

// Existing tokenize is exercised through the REPL at runtime; spot-check
// here so it stays green if anyone touches it.
describe("tokenize (REPL command parser)", () => {
  it("splits on whitespace", () => {
    expect(tokenize("companies list")).toEqual(["companies", "list"]);
  });

  it("preserves quoted strings as single tokens", () => {
    expect(tokenize('companies more "Acme Corp" --json')).toEqual([
      "companies",
      "more",
      "Acme Corp",
      "--json",
    ]);
  });

  it("supports single quotes too", () => {
    expect(tokenize("companies show 'Acme Corp'")).toEqual([
      "companies",
      "show",
      "Acme Corp",
    ]);
  });
});
