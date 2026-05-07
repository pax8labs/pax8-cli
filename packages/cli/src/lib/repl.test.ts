// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { resolveCliPath, tokenize } from "./repl.js";

describe("resolveCliPath", () => {
  // Regression: previous logic used `import.meta.url`-based resolution and
  // landed on `packages/cli/index.js` (a file that doesn't exist) at runtime
  // because tsup inlines lib/repl.ts into dist/index.js. Every command typed
  // at the `pax8>` prompt then crashed with MODULE_NOT_FOUND for global
  // installs.

  it("returns the absolute path of process.argv[1] for a global install", () => {
    expect(
      resolveCliPath("/usr/local/lib/node_modules/@pax8/cli/dist/index.js"),
    ).toBe("/usr/local/lib/node_modules/@pax8/cli/dist/index.js");
  });

  it("returns the absolute path of process.argv[1] for a local repo invocation", () => {
    expect(
      resolveCliPath("/Users/jane/code/pax8-cli/packages/cli/dist/index.js"),
    ).toBe("/Users/jane/code/pax8-cli/packages/cli/dist/index.js");
  });

  it("never strips the dist/ segment (the regression)", () => {
    const repoBuild = "/repo/packages/cli/dist/index.js";
    expect(resolveCliPath(repoBuild)).toContain("/dist/");
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
