// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { resolve as resolvePath, sep as pathSep } from "node:path";
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
