// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * How the running `pax8` binary got onto this machine. Drives the
 * upgrade guidance we render — a partner who installed via Homebrew
 * should be told `brew upgrade`, not `npm i -g`, and someone running a
 * one-shot `npx @pax8/cli` has nothing to "upgrade" at all.
 *
 * `unknown` is the honest fallback: we couldn't map the install path to
 * a package manager. We still offer the npm command as best-effort
 * guidance but refuse to auto-run it (see {@link InstallInfo.upgradeArgs}).
 */
export type InstallMethod =
  | "npm-global"
  | "pnpm-global"
  | "yarn-global"
  | "homebrew"
  | "npx"
  | "unknown";

export interface InstallInfo {
  /** Detected install method. */
  method: InstallMethod;
  /** Human-readable package manager name, e.g. "npm", "Homebrew". */
  manager: string;
  /**
   * The upgrade command as a display string, e.g.
   * `npm i -g @pax8/cli@latest`. Always populated (best-effort for
   * `unknown` / `npx`).
   */
  upgradeCommand: string;
  /**
   * Argv for spawning the upgrade non-interactively (first element is the
   * executable). `null` when we shouldn't auto-run it — either because the
   * method is `npx` (nothing to persist) or `unknown` (we won't guess a
   * command and run it against the user's global env). Mirrors the
   * `orderArgs` / `orderCommand` split (#462): the string is for humans,
   * the argv is what a process actually executes.
   */
  upgradeArgs: string[] | null;
}

/** npm package name — the single source of truth for the upgrade target. */
export const PACKAGE_NAME = "@pax8/cli";

/**
 * Resolve the on-disk path of the running CLI bundle. Under ESM +
 * tsup, `import.meta.url` points at `dist/index.js`; we realpath it so a
 * symlinked global bin (Homebrew and npm both symlink into their bin dirs)
 * resolves to the real Cellar / node_modules location the markers below
 * key off. Falls back to `process.argv[1]` and finally the raw module URL
 * if realpath throws (e.g. the file was unlinked mid-run).
 */
function resolveSelfPath(): string {
  let p: string;
  try {
    p = fileURLToPath(import.meta.url);
  } catch {
    p = process.argv[1] ?? "";
  }
  try {
    p = fs.realpathSync(p);
  } catch {
    // Keep the un-resolved path; the markers still match in most layouts.
  }
  // Normalize Windows separators so a single set of markers works cross-platform.
  return p.replace(/\\/g, "/");
}

/**
 * Classify an install path into a package manager. Split out from
 * {@link getInstallInfo} so it's unit-testable without touching the real
 * filesystem — pass any candidate path and assert the method.
 *
 * Order matters: npx and pnpm/yarn live under paths that also contain
 * `node_modules`, so we test the more specific markers before falling
 * through to the generic npm-global case.
 */
export function classifyInstallPath(rawPath: string): InstallMethod {
  const p = rawPath.replace(/\\/g, "/").toLowerCase();
  if (!p) return "unknown";

  // Homebrew: formulae install under a Cellar and symlink through the
  // prefix. `/cellar/` is the durable marker (both /usr/local and
  // /opt/homebrew layouts contain it); `/homebrew/` and `/linuxbrew/`
  // cover the macOS custom-prefix and linuxbrew cases (including the
  // bin-symlink path before realpath resolves it into the Cellar).
  if (
    p.includes("/cellar/") ||
    p.includes("/homebrew/") ||
    p.includes("/linuxbrew/")
  ) {
    return "homebrew";
  }

  // npx one-shot cache. npm writes these under `_npx/<hash>/node_modules`.
  if (p.includes("/_npx/") || p.includes("/npm-cache/_npx/")) return "npx";

  // pnpm global store. pnpm's global root contains `/pnpm/` (e.g.
  // ~/Library/pnpm/global or ~/.local/share/pnpm/global) and its
  // content-addressable store uses `/.pnpm/`.
  if (p.includes("/pnpm/global/") || p.includes("/.pnpm/") || p.includes("/pnpm-global/")) {
    return "pnpm-global";
  }

  // yarn global installs land under a `.yarn`/`yarn` global dir.
  if (p.includes("/.yarn/") || p.includes("/yarn/global/")) return "yarn-global";

  // Generic npm global: the package sits under a `node_modules` tree that
  // isn't one of the more specific stores above. This also catches the
  // common `<prefix>/lib/node_modules/@pax8/cli` layout.
  if (p.includes("/node_modules/")) return "npm-global";

  return "unknown";
}

/** Build the InstallInfo for a classified method. */
function infoForMethod(method: InstallMethod): InstallInfo {
  switch (method) {
    case "npm-global":
      return {
        method,
        manager: "npm",
        upgradeCommand: `npm i -g ${PACKAGE_NAME}@latest`,
        upgradeArgs: ["npm", "i", "-g", `${PACKAGE_NAME}@latest`],
      };
    case "pnpm-global":
      return {
        method,
        manager: "pnpm",
        upgradeCommand: `pnpm add -g ${PACKAGE_NAME}@latest`,
        upgradeArgs: ["pnpm", "add", "-g", `${PACKAGE_NAME}@latest`],
      };
    case "yarn-global":
      return {
        method,
        manager: "yarn",
        upgradeCommand: `yarn global add ${PACKAGE_NAME}@latest`,
        upgradeArgs: ["yarn", "global", "add", `${PACKAGE_NAME}@latest`],
      };
    case "homebrew":
      return {
        method,
        manager: "Homebrew",
        upgradeCommand: "brew upgrade pax8",
        upgradeArgs: ["brew", "upgrade", "pax8"],
      };
    case "npx":
      // Nothing to upgrade — npx always fetches per-run. Point the user at
      // the pinned-latest invocation; don't offer to auto-run anything.
      return {
        method,
        manager: "npx",
        upgradeCommand: `npx ${PACKAGE_NAME}@latest`,
        upgradeArgs: null,
      };
    case "unknown":
    default:
      // Best-effort guidance, but we won't auto-run a command we can't
      // attribute to a real install.
      return {
        method: "unknown",
        manager: "unknown",
        upgradeCommand: `npm i -g ${PACKAGE_NAME}@latest`,
        upgradeArgs: null,
      };
  }
}

/**
 * Detect how the running CLI was installed and how to upgrade it.
 *
 * Honors the `PAX8_UPGRADE_METHOD` test seam: when set to a valid
 * {@link InstallMethod}, detection is bypassed so subprocess tests get a
 * deterministic, byte-stable install method regardless of where the built
 * CLI happens to live in the test checkout.
 */
export function getInstallInfo(): InstallInfo {
  const forced = process.env.PAX8_UPGRADE_METHOD;
  if (
    forced === "npm-global" ||
    forced === "pnpm-global" ||
    forced === "yarn-global" ||
    forced === "homebrew" ||
    forced === "npx" ||
    forced === "unknown"
  ) {
    return infoForMethod(forced);
  }
  return infoForMethod(classifyInstallPath(resolveSelfPath()));
}
