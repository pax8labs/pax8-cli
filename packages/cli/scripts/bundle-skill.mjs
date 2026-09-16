// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Copy the canonical Claude skill into `dist/` so it ships in the npm
 * tarball (#720).
 *
 * `packages/cli/package.json` packs `dist`, so `dist/skill.md` rides along
 * with no `files` change and no third tracked copy of a file that already
 * exists twice (`packages/claude-skill/skill.md` is canonical;
 * `.claude/skills/pax8/SKILL.md` is what Claude Code loads inside this
 * repo, kept byte-identical by a contract test — #714).
 *
 * Run from tsup's `onSuccess`. Paths resolve against this file's own URL
 * rather than cwd, so it behaves the same from the package directory, the
 * repo root, or a watch rebuild.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SOURCE = fileURLToPath(new URL("../../claude-skill/skill.md", import.meta.url));
const DIST_DIR = fileURLToPath(new URL("../dist/", import.meta.url));
const TARGET = fileURLToPath(new URL("../dist/skill.md", import.meta.url));

if (!existsSync(SOURCE)) {
  // Failing loudly beats publishing a CLI whose `skill install` has
  // nothing to install — the exact gap #720 exists to close.
  console.error(`[bundle-skill] canonical skill not found at ${SOURCE}`);
  process.exit(1);
}

mkdirSync(DIST_DIR, { recursive: true });
copyFileSync(SOURCE, TARGET);
