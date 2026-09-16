// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Locating, fingerprinting, and comparing the shipped Claude Code skill (#720).
 *
 * `packages/claude-skill/skill.md` is the agent-facing safety contract —
 * the read/write classification, the `isWrite` rule, the #707 SKU-
 * verification guard. Until #720 it shipped in neither published
 * artifact: `@pax8/cli` packs only `dist`, and `@pax8/claude-skill` is
 * `private: true`. Partners running Claude Code against `pax8` therefore
 * got an agent improvising around a CLI that can place real orders.
 *
 * Two halves fix that, and this module is the shared piece:
 *
 *   - the build copies the canonical `skill.md` into `dist/` (see
 *     `packages/cli/scripts/bundle-skill.mjs`), so it rides along in the
 *     npm tarball;
 *   - `pax8 skill install` copies it into the directory Claude Code
 *     actually reads, and `pax8 doctor` reports when an installed copy
 *     has fallen behind the shipped one.
 *
 * The drift half is not hypothetical. `.claude/skills/pax8/SKILL.md` in
 * this repo was gitignored for six months, so every correction landed in
 * the canonical file and reached no agent (#714). A partner who installs
 * once and upgrades the CLI five times is in exactly that position, with
 * nothing to tell them.
 */

import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/** Where an installed copy lives: the user's Claude dir, or this project. */
export type SkillScope = "global" | "project";

/** Directory name under `skills/`. Must match the skill's frontmatter `name`. */
export const SKILL_NAME = "pax8";
/** Filename Claude Code loads. Uppercase is the convention it looks for. */
export const SKILL_FILE = "SKILL.md";
/**
 * Provenance sidecar written next to an installed copy.
 *
 * It records the checksum we wrote, which is what lets `install` tell a
 * *stale* copy (unmodified, just older — safe to refresh) from an *edited*
 * one (a partner's local changes — refuse without `--force`). Without it
 * every difference looks the same and the only safe answer is to refuse,
 * which makes routine upgrades hostile.
 *
 * A leading dot keeps it out of the way; Claude Code loads `SKILL.md`.
 */
export const SKILL_META_FILE = ".pax8-skill.json";

/**
 * Candidate locations for the shipped `skill.md`, resolved against this
 * module's own URL so nothing depends on the process's cwd.
 *
 *   1. `./skill.md` — the published layout. tsup bundles every source
 *      file into `dist/index.js`, so at runtime `import.meta.url` is that
 *      bundle and the sibling is `dist/skill.md`.
 *   2. `../../claude-skill/skill.md` — a `dist/` build inside the
 *      monorepo whose copy step hasn't run yet.
 *   3. `../../../claude-skill/skill.md` — `pnpm dev` (tsx), where
 *      `import.meta.url` is this source file under `src/lib/`.
 */
const SHIPPED_CANDIDATES = [
  "./skill.md",
  "../../claude-skill/skill.md",
  "../../../claude-skill/skill.md",
];

/** `sha256:<hex>` over the UTF-8 bytes. Stable across platforms. */
export function checksum(content: string): string {
  return `sha256:${createHash("sha256").update(content, "utf-8").digest("hex")}`;
}

/** Absolute path of the shipped skill, or `null` if the build dropped it. */
export function findShippedSkillPath(): string | null {
  for (const candidate of SHIPPED_CANDIDATES) {
    const resolved = fileURLToPath(new URL(candidate, import.meta.url));
    if (existsSync(resolved)) return resolved;
  }
  return null;
}

export interface ShippedSkill {
  path: string;
  content: string;
  checksum: string;
}

/** Read the shipped skill. Returns `null` when it isn't in the package. */
export function readShippedSkill(): ShippedSkill | null {
  const shippedPath = findShippedSkillPath();
  if (!shippedPath) return null;
  const content = readFileSync(shippedPath, "utf-8");
  return { path: shippedPath, content, checksum: checksum(content) };
}

/**
 * Claude Code's config directory — `~/.claude`, or `CLAUDE_CONFIG_DIR`
 * when the user has relocated it.
 *
 * This is the one place in the CLI that resolves a home-relative path
 * outside `~/.pax8`, which is why it's exempted in
 * `__tests__/local-state-writers.test.ts`: `getConfigDir()` deliberately
 * cannot name it. The directory belongs to a different tool, so we honor
 * that tool's own override rather than inventing a `PAX8_*` variable.
 */
export function claudeConfigDir(): string {
  const override = process.env.CLAUDE_CONFIG_DIR?.trim();
  if (override) return path.resolve(override);
  return path.join(homedir(), ".claude");
}

/** Directory an installed copy lives in, for the given scope. */
export function skillInstallDir(scope: SkillScope): string {
  const base = scope === "global" ? claudeConfigDir() : path.join(process.cwd(), ".claude");
  return path.join(base, "skills", SKILL_NAME);
}

/** Full path of the installed `SKILL.md` for the given scope. */
export function skillInstallPath(scope: SkillScope): string {
  return path.join(skillInstallDir(scope), SKILL_FILE);
}

/** Provenance sidecar contents. Every field is informational. */
export interface SkillMeta {
  /** Always `"@pax8/cli"` — marks the file as ours rather than hand-written. */
  source: string;
  /** CLI version that wrote it. What a stale-install message names. */
  cliVersion: string;
  /** ISO-8601 write time. */
  installedAt: string;
  /** Checksum of the content we wrote. See SKILL_META_FILE. */
  checksum: string;
}

export interface InstalledSkill {
  scope: SkillScope;
  dir: string;
  path: string;
  exists: boolean;
  /** Present when `exists` and the file was readable. */
  content?: string;
  /** Present when `content` is. */
  checksum?: string;
  /** Parsed sidecar, when one is present and well-formed. */
  meta?: SkillMeta;
  /** True when the file is a symlink — we refuse to write through it. */
  isSymlink: boolean;
  /** Set when the file exists but couldn't be read. */
  readError?: string;
}

function readMeta(dir: string): SkillMeta | undefined {
  try {
    const raw = readFileSync(path.join(dir, SKILL_META_FILE), "utf-8");
    const parsed = JSON.parse(raw) as Partial<SkillMeta>;
    if (typeof parsed.checksum !== "string") return undefined;
    return {
      source: typeof parsed.source === "string" ? parsed.source : "unknown",
      cliVersion: typeof parsed.cliVersion === "string" ? parsed.cliVersion : "unknown",
      installedAt: typeof parsed.installedAt === "string" ? parsed.installedAt : "unknown",
      checksum: parsed.checksum,
    };
  } catch {
    // Missing or malformed sidecar. Treated as "no provenance", which is
    // the conservative answer: an install with unknown provenance needs
    // --force rather than being silently overwritten.
    return undefined;
  }
}

/** Inspect the installed copy for a scope. Never throws. */
export function readInstalledSkill(scope: SkillScope): InstalledSkill {
  const dir = skillInstallDir(scope);
  const filePath = skillInstallPath(scope);
  let stats;
  try {
    stats = lstatSync(filePath);
  } catch {
    return { scope, dir, path: filePath, exists: false, isSymlink: false };
  }
  const isSymlink = stats.isSymbolicLink();
  try {
    const content = readFileSync(filePath, "utf-8");
    return {
      scope,
      dir,
      path: filePath,
      exists: true,
      content,
      checksum: checksum(content),
      meta: readMeta(dir),
      isSymlink,
    };
  } catch (err) {
    return {
      scope,
      dir,
      path: filePath,
      exists: true,
      isSymlink,
      readError: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * What an installed copy is, relative to the shipped one.
 *
 *   - `absent`    — nothing installed.
 *   - `current`   — byte-identical to what this CLI ships.
 *   - `stale`     — differs, but matches the checksum we recorded when we
 *                   wrote it, so nobody has edited it: a plain upgrade.
 *   - `modified`  — differs, and we can't prove we wrote what's there.
 *                   Refuse without `--force`.
 *   - `unreadable`— exists but couldn't be read (permissions, symlink).
 */
export type SkillInstallState = "absent" | "current" | "stale" | "modified" | "unreadable";

export function classifyInstall(
  installed: InstalledSkill,
  shippedChecksum: string,
): SkillInstallState {
  if (!installed.exists) return "absent";
  if (installed.content === undefined) return "unreadable";
  if (installed.checksum === shippedChecksum) return "current";
  if (installed.meta && installed.meta.checksum === installed.checksum) return "stale";
  return "modified";
}

/**
 * One line naming how far apart two copies are.
 *
 * Deliberately a summary rather than a diff: the skill is ~700 lines and
 * a full diff in a terminal error is unreadable. Line-multiset counts
 * plus the first differing line number are enough for a partner to
 * decide whether they care, and `--print` is there for the rest.
 */
export function summarizeDrift(shipped: string, installed: string): string {
  const a = shipped.split("\n");
  const b = installed.split("\n");
  let firstDiff = 0;
  const shared = Math.min(a.length, b.length);
  while (firstDiff < shared && a[firstDiff] === b[firstDiff]) firstDiff++;

  const remaining = new Map<string, number>();
  for (const line of a) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  let onlyInstalled = 0;
  for (const line of b) {
    const n = remaining.get(line) ?? 0;
    if (n > 0) remaining.set(line, n - 1);
    else onlyInstalled++;
  }
  let onlyShipped = 0;
  for (const n of remaining.values()) onlyShipped += n;

  const plural = (n: number): string => (n === 1 ? "line" : "lines");
  return (
    `${onlyShipped} ${plural(onlyShipped)} only in the shipped skill, ` +
    `${onlyInstalled} ${plural(onlyInstalled)} only in yours; ` +
    `first difference at line ${firstDiff + 1}`
  );
}
