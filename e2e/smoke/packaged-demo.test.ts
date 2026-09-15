// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Packaged-artifact smoke test (#697).
 *
 * Installs the CLI into a clean directory **outside** the pnpm workspace and
 * runs the README's "run with demo data" commands against it.
 *
 * The point is the dependency resolution, not the commands. Inside the
 * workspace, `@pax8/core` is a symlink to `packages/core` — so every other
 * suite tests the CLI against core's *source*. A real install resolves
 * `@pax8/core` from the registry at whatever version `pnpm publish` pinned when
 * it rewrote `workspace:*`. When those disagree the CLI calls into a core API
 * that isn't there, which is how `@pax8/cli@0.2.0` shipped dying on
 * `getTelemetry(...).setAccount is not a function` for every command.
 *
 * Two targets:
 * - `local` (default) — `pnpm pack` the workspace packages and install the
 *   cli tarball. Its `@pax8/core` dependency still resolves from the registry,
 *   so this reproduces the publish-time skew without publishing anything.
 *   **Manual / opt-in: no workflow runs this.** It cannot be an automated
 *   pre-publish gate as things stand — during a release the packed CLI pins
 *   the core version being released, which by definition isn't on npm yet, so
 *   the install would 404. Making it a real gate means splitting the
 *   changesets publish so core goes out first; tracked separately.
 *   Run it by hand when touching anything in `packages/core` that the CLI
 *   imports, and it is the fastest way to reproduce a reported version skew.
 * - `registry` — install `@pax8/cli@$PAX8_SMOKE_VERSION` (default `latest`)
 *   straight from npm. This is the post-release canary and the one that is
 *   automated: `release.yml` runs it after a successful publish. It tests
 *   exactly what users get.
 */

const TARGET = process.env.PAX8_SMOKE_TARGET ?? "local";
const VERSION = process.env.PAX8_SMOKE_VERSION ?? "latest";
const __dirname = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

/** Commands from README "Run with demo data" + the ones that regressed in #697. */
const DEMO_COMMANDS: string[][] = [
  ["dashboard"],
  ["invoices", "audit"],
  ["subscriptions", "renewals", "--within", "30d"],
  ["recommendations", "list"],
  ["clients", "list"],
];

let installDir: string;
let cliBin: string;
/**
 * Set ONLY when the registry is genuinely unreachable. Every other failure
 * rethrows out of `beforeAll` so the suite goes red — an early `return` in
 * each test would otherwise turn "we couldn't even install it" into a silent
 * pass, which is the same class of blind spot this file exists to close.
 */
let offlineSkip = false;

const NETWORK_ERROR = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|network/i;

function run(
  cmd: string,
  args: string[],
  cwd: string,
): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, PAX8_DEMO: "1", PAX8_NO_UPDATE_CHECK: "1" },
    // npm on a cold cache is slow; the per-test timeout above is the real bound.
    timeout: 280_000,
  });
  return {
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
    status: res.status ?? 1,
  };
}

beforeAll(() => {
  try {
    installDir = mkdtempSync(join(tmpdir(), "pax8-smoke-"));
    // A bare package.json with no workspace field — nothing links back to the
    // monorepo, so `@pax8/core` must come from the registry.
    writeFileSync(
      join(installDir, "package.json"),
      JSON.stringify({ name: "pax8-smoke", version: "1.0.0", private: true }, null, 2),
    );

    let installSpec: string;
    if (TARGET === "registry") {
      installSpec = `@pax8/cli@${VERSION}`;
    } else {
      // Pack the workspace CLI. `pnpm pack` rewrites `workspace:*` to the
      // concrete core version exactly as `pnpm publish` would — which is the
      // whole point: the tarball then pulls that core from the registry.
      // Note `pnpm pack` takes no `--filter` (pnpm 9 reads it as `--recursive`
      // and errors), so run it from the package directory.
      const packDir = mkdtempSync(join(tmpdir(), "pax8-pack-"));
      const packed = run(
        "pnpm",
        ["pack", "--pack-destination", packDir],
        join(REPO_ROOT, "packages", "cli"),
      );
      const tarball = readdirSync(packDir).find((f) => f.endsWith(".tgz"));
      if (!tarball) {
        throw new Error(
          `pnpm pack produced no tarball in ${packDir}\n${packed.stdout}\n${packed.stderr}`,
        );
      }
      installSpec = join(packDir, tarball);
    }

    const install = run("npm", ["install", "--no-audit", "--no-fund", installSpec], installDir);
    if (install.status !== 0) {
      throw new Error(`install of ${installSpec} failed:\n${install.stderr}`);
    }
    cliBin = join(installDir, "node_modules", ".bin", "pax8");
  } catch (err) {
    const error = err as Error;
    // An offline machine should skip, not fail red. Anything else is a real
    // finding and must propagate.
    if (NETWORK_ERROR.test(error.message)) {
      offlineSkip = true;
      return;
    }
    throw error;
  }
});

afterAll(() => {
  if (installDir) rmSync(installDir, { recursive: true, force: true });
});

describe(`packaged CLI demo smoke (target=${TARGET})`, () => {
  // `it.skipIf(...)` is evaluated during collection, before `beforeAll` has
  // run — it would always read the initial `false`. Skip from inside the test
  // body instead, where `offlineSkip` is settled.
  const skipIfOffline = (ctx: { skip: () => void }) => {
    if (offlineSkip) ctx.skip();
  };

  it("installs outside the workspace", (ctx) => {
    skipIfOffline(ctx);
    expect(existsSync(cliBin)).toBe(true);
  });

  it("resolves @pax8/core from the registry, not the workspace", (ctx) => {
    skipIfOffline(ctx);
    const corePkg = join(installDir, "node_modules", "@pax8", "core", "package.json");
    expect(existsSync(corePkg)).toBe(true);
    // A workspace symlink would resolve back into the repo; a registry install
    // must stay inside the temp dir.
    expect(realpathSync(corePkg).startsWith(REPO_ROOT)).toBe(false);
  });

  /**
   * The drift check proper.
   *
   * Running the demo commands proves the CLI doesn't *crash*, but now that
   * `resolveTelemetryAccount()` degrades gracefully (#697) a missing core API
   * would clear that bar while silently dropping functionality. So check the
   * real invariant directly: **every `@pax8/core` name the CLI imports must
   * exist in the core version the packaged CLI actually resolved.**
   *
   * Deliberately scoped to what the CLI imports rather than diffing the two
   * export surfaces wholesale — core may legitimately carry unreleased exports
   * that no CLI code references yet, and that shouldn't fail anyone's PR.
   */
  it("resolved @pax8/core provides every API the CLI imports", async (ctx) => {
    skipIfOffline(ctx);
    if (TARGET === "registry") ctx.skip(); // a released CLI predates local source

    const ts = (await import("typescript")).default;

    const collect = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collect(full, out);
        else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) out.push(full);
      }
      return out;
    };

    // What the CLI asks of core, per the compiler's own parse — no regexes over
    // multi-line import blocks.
    const imported = new Set<string>();
    for (const file of collect(join(REPO_ROOT, "packages", "cli", "src"))) {
      const sf = ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
      for (const stmt of sf.statements) {
        if (!ts.isImportDeclaration(stmt)) continue;
        if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
        if (stmt.moduleSpecifier.text !== "@pax8/core") continue;
        const bindings = stmt.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            imported.add((el.propertyName ?? el.name).text);
          }
        }
      }
    }
    expect(imported.size).toBeGreaterThan(0); // guard against a silent no-op

    // What the resolved core actually provides.
    const coreRoot = join(installDir, "node_modules", "@pax8", "core");
    const dtsPath = join(coreRoot, "dist", "index.d.ts");
    const dts = ts.createSourceFile(
      dtsPath,
      readFileSync(dtsPath, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const exported = new Set<string>();
    for (const stmt of dts.statements) {
      if (
        ts.isExportDeclaration(stmt) &&
        stmt.exportClause &&
        ts.isNamedExports(stmt.exportClause)
      ) {
        for (const el of stmt.exportClause.elements) exported.add(el.name.text);
      }
      const named = stmt as unknown as { name?: { text?: string } };
      if (named.name?.text) exported.add(named.name.text);
    }

    const version = JSON.parse(readFileSync(join(coreRoot, "package.json"), "utf8")).version;
    const missing = [...imported].filter((n) => !exported.has(n)).sort();
    expect(
      missing,
      `The CLI imports these from @pax8/core, but the copy it resolves ` +
        `(@pax8/core@${version}, from the registry) does not export them. ` +
        `Core needs a changeset and a release before this CLI can ship.`,
    ).toEqual([]);

    // Member-level drift the export list cannot see. #697 was exactly this
    // shape: an existing export gained a method the published copy lacked.
    // `toContain` on a 200KB .d.ts dumps the whole file into the failure
    // output; assert on a boolean so the message stays readable.
    const text = readFileSync(dtsPath, "utf8");
    for (const member of ["setAccount"]) {
      expect(
        text.includes(member),
        `Telemetry.${member}() is missing from @pax8/core@${version} (the copy the ` +
          `packaged CLI resolves). Release core before the CLI that calls it.`,
      ).toBe(true);
    }
  });

  for (const argv of DEMO_COMMANDS) {
    const label = `pax8 ${argv.join(" ")}`;

    it(`\`${label}\` succeeds under PAX8_DEMO=1`, (ctx) => {
      skipIfOffline(ctx);
      const res = run(cliBin, argv, installDir);
      const combined = `${res.stdout}\n${res.stderr}`;

      // The #697 signature specifically: a core API the published core lacks.
      expect(combined).not.toMatch(/is not a function/);
      expect(combined).not.toMatch(/Cannot find module/);
      expect(res.status, `${label} exited ${res.status}\n${combined}`).toBe(0);
    });

    it(`\`${label} --json\` emits a parseable envelope on stdout`, (ctx) => {
      skipIfOffline(ctx);
      const res = run(cliBin, [...argv, "--json"], installDir);
      expect(res.status, `${label} --json exited ${res.status}\n${res.stderr}`).toBe(0);
      // stdout is data only — stderr carries spinners/banners/warnings.
      expect(() => JSON.parse(res.stdout)).not.toThrow();
    });
  }
});
