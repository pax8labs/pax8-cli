// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);

// __dirname equivalent for ESM.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PKG = path.resolve(HERE, "../..");

/**
 * Regression guard for #624: a `preinstall` lifecycle hook references
 * `./scripts/check-prerequisites.js`, but the published tarball is
 * limited by the `files` allowlist in `packages/cli/package.json`. If
 * the script is in the hook but not in the allowlist, every
 * `npm install -g @pax8/cli` fails with `Cannot find module …` —
 * inverting the intent of the hook (block bad Node) into a universal
 * install failure. Local `pnpm install` masks this because the
 * workspace install runs against the working tree, not a tarball.
 *
 * `npm pack --dry-run` is the cheapest reliable check: it builds the
 * tarball file list without actually packing or publishing, and we
 * grep the output for the script path.
 */
describe("publish artifacts", () => {
  it("npm pack tarball includes scripts/check-prerequisites.js (preinstall hook prereq) (#624)", async () => {
    const { stdout, stderr } = await exec("npm", ["pack", "--dry-run", "--json"], {
      cwd: CLI_PKG,
      env: process.env,
      maxBuffer: 4 * 1024 * 1024,
    });
    // `npm pack --json` emits a JSON array on stdout with one entry per
    // package; each entry carries `files: [{ path, size, mode }, …]`.
    const parsed = JSON.parse(stdout) as Array<{
      files?: Array<{ path: string }>;
    }>;
    expect(parsed, `expected one package entry from npm pack --json; stderr=${stderr}`).toHaveLength(1);
    const filePaths = (parsed[0].files ?? []).map((f) => f.path);
    expect(
      filePaths,
      `tarball file list missing the preinstall script. Files: ${JSON.stringify(filePaths)}`,
    ).toContain("scripts/check-prerequisites.js");
  });
});
