// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs";
import * as path from "node:path";
import chalk from "chalk";
import updateNotifier from "update-notifier";
import { getConfigDir, safeWriteFileSync } from "@pax8/core";

declare const __CLI_VERSION__: string;

/**
 * Lightweight cached envelope describing the most recent successful npm
 * registry lookup for `@pax8/cli`. Persisted under `<configDir>/update-check.json`
 * so the synchronous read in `lib/errors.ts` (the `ERROR_API_VALIDATION`
 * drift-aware path) doesn't have to touch the network and doesn't have to
 * inspect `update-notifier`'s configstore layout.
 *
 * Honors the `PAX8_CONFIG_DIR` isolation seam (#128) — the same one used by
 * credentials, telemetry, and last-error storage — so subprocess tests can't
 * collide on a shared cache file.
 */
export interface CachedUpdateInfo {
  /** Latest published version on npm at the time of the check. */
  latest: string;
  /** CLI version we were running when we performed the check. */
  current: string;
  /** Update-notifier's diff bucket (`major` / `minor` / `patch` / …). */
  type?: string;
  /** Unix epoch (ms) of the registry lookup that produced this record. */
  checkedAt: number;
  /**
   * Version string (e.g. `"0.6.0"`) of the `latest` we last rendered a
   * banner for. Gates "Notice prints once per release" (AC for #183) —
   * once `acknowledgedLatest === latest`, we stay quiet for this release.
   *
   * An earlier shape stored an `acknowledgedAt` timestamp and gated on
   * `acknowledgedAt >= checkedAt`, but `fillCacheFromUpdateNotifier`
   * unconditionally bumps `checkedAt` on every `update-notifier` refresh
   * cycle (~daily) even when `latest` is unchanged, which flipped the
   * invariant and re-fired the banner every day. Version-string equality
   * is immune to clock drift.
   *
   * Legacy `acknowledgedAt` records (from earlier installs) are dropped
   * silently by the reader — those partners see one extra nudge after
   * upgrading, then the new gate takes over.
   */
  acknowledgedLatest?: string;
}

const CACHE_FILE = "update-check.json";
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Resolve the path to our cache file. Lazily references `getConfigDir()`
 * so `PAX8_CONFIG_DIR` is honored per-call (matches the loader's contract).
 */
function cachePath(): string {
  return path.join(getConfigDir(), CACHE_FILE);
}

/**
 * Suppression signals. Honored in this order:
 *
 * User opt-outs (always win):
 *   - `PAX8_NO_UPDATE_CHECK=1` — the project-specific opt-out documented in #183.
 *   - `PAX8_DEMO=1` — demo mode never reaches the network; the check would
 *     either spam the registry from CI or surface a confusing "update available"
 *     hint to a partner who's still evaluating the tool.
 *   - `PAX8_QUIET=1` / `--quiet` / `--json` — clean machine-readable surface.
 *   - `NO_UPDATE_NOTIFIER` and `DO_NOT_TRACK` — community-standard opt-outs.
 *   - `--no-update-notifier` — `update-notifier`'s own per-run flag.
 *
 * Auto-suppressors (skipped when `PAX8_UPDATE_CHECK_TEST_FORCE=1`):
 *   - `NODE_ENV=test` and `CI=true` — `update-notifier` already auto-suppresses
 *     under these, but we mirror the check here so we don't even hit
 *     `updateNotifier()` in tests / CI.
 *   - Non-TTY stderr — never inject a banner into a piped stderr stream
 *     in regular use.
 *
 * `PAX8_UPDATE_CHECK_TEST_FORCE=1` is the seam subprocess tests use to
 * exercise the un-suppressed path without lying about NODE_ENV /
 * isatty / CI. It does NOT override user opt-outs — a test that sets
 * `PAX8_NO_UPDATE_CHECK=1` alongside it still produces no banner, which
 * is exactly the "opt-out wins" assertion the tests pin.
 */
/**
 * Truthy-env predicate. Treats `"1"`, `"true"`, `"yes"`, `"on"` (case-
 * insensitive, whitespace-trimmed) as truthy; everything else — including
 * `"0"`, `"false"`, `""`, and unset — as falsy.
 *
 * Use this for **Pax8-owned `=1`-shape flags** (`PAX8_NO_UPDATE_CHECK`,
 * `PAX8_DEMO`, `PAX8_QUIET`, `PAX8_UPDATE_CHECK_TEST_FORCE`) and for the
 * Do-Not-Track standard which is spec'd as `"1"` / `"0"`. Do NOT use this
 * for presence-shaped community flags — see `presenceEnv`.
 */
export function truthyEnv(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Presence-env predicate. Treats **any non-empty, non-whitespace value**
 * as truthy; only unset / empty / pure-whitespace counts as falsy.
 *
 * Use this for community-convention flags whose canonical shape is
 * presence-based:
 *
 *   - `NO_UPDATE_NOTIFIER` — the upstream `update-notifier` package
 *     suppresses on any non-empty value. CLAUDE.md's env-var docs list
 *     this flag bare (no `=1`), matching the convention.
 *   - `CI` — many providers set `CI` to non-empty values outside the
 *     `1/true` token set (e.g. GitHub Actions sometimes sets `CI=true`
 *     but other providers use platform identifiers). Treating those
 *     as non-CI would re-enable interactive banners in pipelines.
 *
 * The split exists because rolling everything through `truthyEnv`
 * narrows these flags' semantics against established convention — a
 * regression operon-ensemble-reviewer caught on the original consolidation
 * attempt (PR #647 round 1).
 */
export function presenceEnv(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined) return false;
  return raw.trim().length > 0;
}

function isCheckSuppressed(): boolean {
  // User opt-outs — always respected, regardless of the test-force seam.
  if (truthyEnv("PAX8_NO_UPDATE_CHECK")) return true;
  if (truthyEnv("PAX8_DEMO")) return true;
  if (truthyEnv("PAX8_QUIET")) return true;
  // Presence semantics — update-notifier's own convention.
  if (presenceEnv("NO_UPDATE_NOTIFIER")) return true;
  // DNT is spec'd as "1" / "0" — strict truthy is correct.
  if (truthyEnv("DO_NOT_TRACK")) return true;
  if (process.argv.includes("--json")) return true;
  if (process.argv.includes("--quiet")) return true;
  if (process.argv.includes("--no-update-notifier")) return true;

  // Auto-suppressors — bypassed by the test-force seam.
  if (truthyEnv("PAX8_UPDATE_CHECK_TEST_FORCE")) return false;
  if (process.env.NODE_ENV === "test") return true;
  // Presence semantics — many CI providers set CI to non-token values.
  if (presenceEnv("CI")) return true;
  // Banner is a courtesy for interactive humans; never write it to a
  // non-TTY stderr because something downstream is consuming it.
  if (!process.stderr.isTTY) return true;
  return false;
}

/**
 * Best-effort, naive semver-greater-than. We accept up to three numeric
 * components plus an optional pre-release tag; non-conforming versions
 * fall back to a string compare. Sufficient for the `latest > current`
 * question this module asks — we deliberately don't pull in `semver` as
 * a direct dep just for this one comparison (update-notifier ships its
 * own semver but we mustn't reach into the transitive).
 */
export function isNewerVersion(latest: string, current: string): boolean {
  if (latest === current) return false;
  const parts = (v: string): number[] =>
    v
      .replace(/[^0-9.].*$/, "") // strip pre-release / build metadata
      .split(".")
      .slice(0, 3)
      .map((s) => Number.parseInt(s, 10))
      .map((n) => (Number.isFinite(n) ? n : 0));
  const a = parts(latest);
  const b = parts(current);
  for (let i = 0; i < 3; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av > bv) return true;
    if (av < bv) return false;
  }
  // Same numeric prefix — defer to a lexical comparison so pre-release
  // ordering (e.g. `1.0.0-rc.1` vs `1.0.0`) at least has a deterministic
  // answer. update-notifier itself uses `semverGt`, so anything that
  // reaches the cache has already been validated; this is the floor.
  return latest > current;
}

/**
 * Synchronous read of the cached update info. Returns `null` when the
 * cache is missing, unparseable, stale relative to the current CLI version
 * (the user upgraded since the last check; the cached "latest" no longer
 * applies), or when the cached `latest` is not strictly newer than the
 * running version.
 *
 * Called from the `ERROR_API_VALIDATION` path in `lib/errors.ts` — must
 * NEVER perform I/O beyond the single sync file read, and must NEVER throw.
 */
export function readCachedUpdateInfo(): CachedUpdateInfo | null {
  try {
    const raw = fs.readFileSync(cachePath(), "utf-8");
    const parsed = JSON.parse(raw) as Partial<CachedUpdateInfo>;
    if (
      typeof parsed.latest !== "string" ||
      typeof parsed.current !== "string" ||
      typeof parsed.checkedAt !== "number"
    ) {
      return null;
    }
    const running = getCurrentVersion();
    // The cached `current` is the version we were running when the check
    // last succeeded. If the partner has since upgraded past it (or past
    // the cached `latest`), the cache is stale — drop it rather than
    // surfacing a misleading "newer version available" hint.
    if (!isNewerVersion(parsed.latest, running)) return null;
    return {
      latest: parsed.latest,
      current: parsed.current,
      type: typeof parsed.type === "string" ? parsed.type : undefined,
      checkedAt: parsed.checkedAt,
      acknowledgedLatest:
        typeof parsed.acknowledgedLatest === "string"
          ? parsed.acknowledgedLatest
          : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Persist the cache record. Failures are swallowed — the update banner is
 * a courtesy and must never break the CLI. Routed through `safeWriteFileSync`
 * per the #458/#469 local-state-writer policy (the meta-test in
 * `__tests__/local-state-writers.test.ts` enforces it). Steady-state writes
 * over an existing file are fine — `safeWriteFileSync`'s O_NOFOLLOW + 0600
 * semantics still apply; we just want the same hardened path every CLI
 * writer takes.
 */
function writeCache(info: CachedUpdateInfo): void {
  try {
    const dir = getConfigDir();
    fs.mkdirSync(dir, { recursive: true });
    safeWriteFileSync(cachePath(), JSON.stringify(info, null, 2));
  } catch {
    // Cache writes are best-effort; never crash the CLI.
  }
}

function getCurrentVersion(): string {
  return typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0";
}

/**
 * Trigger an update check. Cheap: `update-notifier` reads its configstore
 * synchronously and the actual network refresh runs in a detached child
 * process — the current process is unblocked the moment we return.
 *
 * Two-stage rendering pipeline, mirroring `update-notifier`'s own
 * "show banner from a previously cached check" pattern:
 *
 *   1. **Cache-fill stage.** Ask `update-notifier` for the cached
 *      registry result. If `notifier.update` reports a newer version,
 *      mirror it into `<configDir>/update-check.json`. This is the only
 *      path that touches the network (via update-notifier's detached
 *      child) and the only path that produces a cache record on the
 *      partner's real machine.
 *
 *   2. **Render stage.** Re-read our own cache and decide whether to
 *      print the banner based on its `acknowledgedLatest` field. We
 *      render once per `latest` value, then stamp
 *      `acknowledgedLatest = cached.latest` so subsequent invocations
 *      stay quiet until a newer release lands (and `fillCache…` clears
 *      the field). This stage is what subprocess tests exercise: they
 *      pre-populate the cache file and assert the banner fires without
 *      ever reaching update-notifier (which auto-suppresses under
 *      `NODE_ENV=test`).
 *
 * Renders the nudge to **stderr** when a newer version is cached, so a
 * `pax8 ... --json | jq` pipeline never sees it.
 *
 * Returns silently — callers don't need the result; the side effects are
 * the contract.
 */
export function runUpdateCheck(): void {
  if (isCheckSuppressed()) return;

  fillCacheFromUpdateNotifier();
  renderFromCacheIfDue();
}

/**
 * Stage 1 — let `update-notifier` do its job (synchronous configstore
 * read, detached child-process refresh) and mirror any newer-version
 * record it surfaces into our own cache. Swallows everything; the
 * banner is never load-bearing.
 *
 * Skips entirely under `NODE_ENV=test` because update-notifier's
 * internal `#isDisabled` flag will refuse to initialize its
 * configstore in that environment — calling through is wasted work,
 * and the test-force seam exists for tests that need to exercise the
 * render-from-cache path without touching update-notifier at all.
 */
function fillCacheFromUpdateNotifier(): void {
  if (process.env.NODE_ENV === "test") return;
  if (truthyEnv("PAX8_UPDATE_CHECK_TEST_FORCE")) return;

  // Redirect `update-notifier`'s configstore under our config-dir
  // isolation root. configstore reads `XDG_CONFIG_HOME` at construction
  // time, so this needs to be set before the call. Restore the original
  // afterwards so we don't leak the override to any later code that uses
  // xdg-basedir.
  const previousXdg = process.env.XDG_CONFIG_HOME;
  try {
    const xdgRoot = path.join(getConfigDir(), "xdg");
    fs.mkdirSync(xdgRoot, { recursive: true });
    process.env.XDG_CONFIG_HOME = xdgRoot;
  } catch {
    // If we can't mkdir under PAX8_CONFIG_DIR, give up — better to skip
    // the check than to write to the user's real XDG dir from a test.
    return;
  }

  try {
    const notifier = updateNotifier({
      pkg: {
        name: "@pax8/cli",
        version: getCurrentVersion(),
      },
      // Default is 1 day — explicit for documentation.
      updateCheckInterval: ONE_DAY_MS,
    });

    const update = notifier.update;
    if (update && isNewerVersion(update.latest, update.current)) {
      // Preserve any existing `acknowledgedLatest` only if it matches the
      // same `latest` — a newer release invalidates the prior ack and
      // the partner should see the banner once for the new version.
      const existing = readCachedUpdateInfo();
      const acknowledgedLatest =
        existing && existing.latest === update.latest
          ? existing.acknowledgedLatest
          : undefined;
      writeCache({
        latest: update.latest,
        current: update.current,
        type: update.type,
        checkedAt: Date.now(),
        acknowledgedLatest,
      });
    }
  } catch {
    // update-notifier can throw if it fails to create its configstore
    // (EACCES under restrictive sandboxes). We swallow.
  } finally {
    if (previousXdg === undefined) {
      delete process.env.XDG_CONFIG_HOME;
    } else {
      process.env.XDG_CONFIG_HOME = previousXdg;
    }
  }
}

/**
 * Stage 2 — render the banner if our cache has a fresh newer-version
 * record we haven't surfaced yet. Stamps
 * `acknowledgedLatest = cached.latest` after rendering so the banner
 * stays quiet for that `latest` until a newer release lands in the
 * cache (AC: "Notice prints once per release").
 */
function renderFromCacheIfDue(): void {
  const cached = readCachedUpdateInfo();
  if (!cached) return;
  // Already rendered for this `latest` — stay quiet. The pre-fix code
  // used `acknowledgedAt >= checkedAt`, but `checkedAt` advances every
  // refresh cycle (~daily) so the invariant broke. Version-string
  // equality is the durable gate.
  if (cached.acknowledgedLatest === cached.latest) return;
  // Pass the RUNNING version (not `cached.current`) as the "from" so a
  // partner who upgraded mid-cycle sees an accurate "0.7.0 → 1.0.0" rather
  // than the stale recorded version.
  renderNudge(getCurrentVersion(), cached.latest);
  writeCache({
    ...cached,
    acknowledgedLatest: cached.latest,
  });
}

/**
 * Render the one-line nudge to stderr. Format intentionally compact —
 * not a boxen banner — because the same channel is shared with spinners,
 * the time-of-day quip, demo-mode banner, and the welcome screen. A
 * multi-line boxen would dominate that surface.
 *
 * Color is applied via `chalk`; `NO_COLOR` and `--no-color` are honored
 * by chalk automatically (it auto-detects), so we don't gate this
 * write ourselves.
 */
function renderNudge(current: string, latest: string): void {
  const line =
    chalk.yellow("⚠") +
    chalk.dim(
      ` A new version of pax8-cli is available (${current} → ${latest}). ` +
        "Run `npm i -g @pax8/cli` to update.\n",
    );
  process.stderr.write(line);
}

/**
 * Format the drift-aware hint for the `ERROR_API_VALIDATION` recovery
 * step. Lives here so the wording stays adjacent to the cache it reads.
 * Returns `null` when there's no cached newer version (caller skips the
 * hint).
 */
export function getApiValidationUpgradeHint(): string | null {
  const info = readCachedUpdateInfo();
  if (!info) return null;
  return (
    `A newer version of pax8-cli (${info.latest}) is available and may include a fix. ` +
    "Run `npm i -g @pax8/cli` to update."
  );
}
