// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { spawn } from "node:child_process";
import { handleCommandError, CliError } from "../lib/errors.js";
import { confirm, replCmd } from "../lib/confirm.js";
import { getOutputFormat, resolveDemoModeAsync } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { setTelemetryFields } from "../lib/telemetry-context.js";
import { getInstallInfo, PACKAGE_NAME, type InstallInfo } from "../lib/install-method.js";
import { readCachedUpdateInfo, isNewerVersion } from "../lib/update-check.js";
import { ERROR_API_TIMEOUT } from "@pax8/core";

// Build-time injected by tsup (see tsup.config.ts).
declare const __CLI_VERSION__: string;

function getCurrentVersion(): string {
  return typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";
}

const REGISTRY_TIMEOUT_MS = 10_000;

/**
 * Resolve the latest published version of `@pax8/cli`.
 *
 * Resolution order:
 *   1. `PAX8_UPGRADE_LATEST` test seam — deterministic version, no network.
 *      The sentinel value `"unknown"` forces the "can't determine latest"
 *      path so that error envelope is testable without blocking the network.
 *   2. Demo mode — never touch the network; use a cached update-check record
 *      if one exists (so a seeded cache can still surface a newer version),
 *      otherwise report the running version so `pax8 upgrade` is benignly
 *      "up to date" rather than erroring on a lookup demo mode must not run.
 *   3. Live npm registry lookup (the dist-tag `latest` endpoint), with a
 *      hard timeout. On any failure, fall back to the cached record so an
 *      offline `pax8 upgrade` can still surface a known-newer version.
 *
 * Returns `null` when the latest version genuinely can't be determined
 * (only reachable outside demo mode, or via the `"unknown"` sentinel).
 */
async function resolveLatestVersion(demo: boolean): Promise<string | null> {
  const seam = process.env.PAX8_UPGRADE_LATEST;
  if (seam && seam.trim().length > 0) {
    const v = seam.trim();
    return v === "unknown" ? null : v;
  }

  if (demo) {
    return readCachedUpdateInfo()?.latest ?? getCurrentVersion();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REGISTRY_TIMEOUT_MS);
  try {
    // Slash in the scope must be percent-encoded for the registry path; the
    // `@` is accepted verbatim by registry.npmjs.org.
    const url = `https://registry.npmjs.org/${PACKAGE_NAME.replace("/", "%2F")}/latest`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) return readCachedUpdateInfo()?.latest ?? null;
    const body = (await res.json()) as { version?: unknown };
    if (typeof body.version === "string" && body.version.length > 0) {
      return body.version;
    }
    return readCachedUpdateInfo()?.latest ?? null;
  } catch {
    // Network error / timeout / bad JSON — best-effort fall back to cache.
    return readCachedUpdateInfo()?.latest ?? null;
  } finally {
    clearTimeout(timer);
  }
}

/** Spawn the package-manager upgrade, inheriting stdio. Resolves to the exit code. */
function runUpgrade(argv: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    // shell:false — argv is a fixed, code-owned command with no
    // user-interpolated tokens, so there's nothing to quote and no shell to
    // invoke. stdio inherited so the partner sees npm/brew's own progress.
    const child = spawn(cmd, args, { stdio: "inherit", shell: false });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 0));
  });
}

interface UpgradeResult {
  package: string;
  current: string;
  latest: string | null;
  upToDate: boolean;
  installMethod: InstallInfo["method"];
  manager: string;
  upgradeCommand: string;
  upgradeArgs: string[] | null;
  action: "up-to-date" | "checked" | "manual" | "upgraded" | "skipped";
}

export const upgradeCommand = new Command("upgrade")
  .description("Check for and install the latest version of pax8-cli")
  .option("--check", "Only report whether a newer version is available; don't install")
  .option("-y, --yes", "Skip the confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 upgrade                 # check for a newer version and install it (with confirmation)
  pax8 upgrade --check         # report current vs latest without installing
  pax8 upgrade -y              # install without a confirmation prompt
  pax8 upgrade --check --json  # machine-readable version report`,
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const outputFormat = getOutputFormat(allOpts);
    const jsonMode = outputFormat === "json";
    const checkOnly = !!allOpts.check;

    try {
      const demo = await resolveDemoModeAsync();
      const info = getInstallInfo();
      const current = getCurrentVersion();

      const spinner =
        jsonMode || checkOnly
          ? null
          : createSpinner("Checking for updates...").start();
      const latest = await resolveLatestVersion(demo);
      spinner?.stop();

      if (latest === null) {
        throw new CliError(
          "Couldn't determine the latest version of pax8-cli",
          ["The npm registry lookup failed and no cached version info is available"],
          [
            "Check your network connection and try again",
            `Or upgrade manually: ${info.upgradeCommand}`,
          ],
          undefined,
          ERROR_API_TIMEOUT,
        );
      }

      const upToDate = !isNewerVersion(latest, current);

      const emit = (action: UpgradeResult["action"]): void => {
        setTelemetryFields({
          upgrade_action: action,
          upgrade_method: info.method,
          upgrade_from: current,
          upgrade_to: latest,
        });
        if (jsonMode) {
          const result: UpgradeResult = {
            package: PACKAGE_NAME,
            current,
            latest,
            upToDate,
            installMethod: info.method,
            manager: info.manager,
            upgradeCommand: info.upgradeCommand,
            upgradeArgs: info.upgradeArgs,
            action,
          };
          process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        }
      };

      // ── Already current ──
      if (upToDate) {
        if (!jsonMode) {
          process.stdout.write(
            chalk.green(`  ✓ pax8-cli is up to date (${current}).\n`),
          );
        }
        emit("up-to-date");
        return;
      }

      // ── Newer version available ──
      if (!jsonMode) {
        process.stdout.write(
          chalk.bold(`\n  A new version of pax8-cli is available.\n\n`) +
            `  ${chalk.dim("Current:".padEnd(10))}${current}\n` +
            `  ${chalk.dim("Latest:".padEnd(10))}${chalk.green(latest)}\n\n`,
        );
      }

      // Report-only: --check, or a method we won't auto-run (npx / unknown).
      // Capture into a local so TS narrows `string[] | null` → `string[]`
      // past this guard (a property access wouldn't stay narrowed).
      const runnableArgs = info.upgradeArgs;
      if (checkOnly || runnableArgs === null) {
        if (!jsonMode) {
          const verb = checkOnly ? "To upgrade, run" : "Upgrade with";
          process.stdout.write(
            `  ${chalk.dim(verb + ":")} ${chalk.cyan(info.upgradeCommand)}\n\n`,
          );
        }
        emit(checkOnly ? "checked" : "manual");
        return;
      }

      // ── Confirm + install ──
      const ok = await confirm(
        `Upgrade pax8-cli ${current} → ${latest} via ${info.manager}?`,
        { default: true },
      );
      if (!ok) {
        if (!jsonMode) process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        emit("checked");
        return;
      }

      // Never shell out to a real package manager under demo mode or the
      // no-exec test seam — demo/CI must stay hermetic. We still report what
      // would have run so the flow is observable end-to-end.
      const noExec = demo || process.env.PAX8_UPGRADE_NO_EXEC === "1";
      if (noExec) {
        if (!jsonMode) {
          process.stdout.write(
            chalk.dim(`  (skipped — would run: ${info.upgradeCommand})\n\n`),
          );
        }
        emit("skipped");
        return;
      }

      if (!jsonMode) {
        process.stdout.write(chalk.dim(`  Running: ${info.upgradeCommand}\n\n`));
      }
      const code = await runUpgrade(runnableArgs);
      if (code !== 0) {
        throw new CliError(
          `Upgrade failed (${info.manager} exited with code ${code})`,
          [`The command \`${info.upgradeCommand}\` did not complete successfully`],
          [
            "Re-run the command directly to see the full output",
            "On permission errors, your global install may need elevated privileges (e.g. sudo)",
          ],
          undefined,
          ERROR_API_TIMEOUT,
        );
      }

      if (!jsonMode) {
        process.stdout.write(
          chalk.green(`\n  ✓ Upgraded pax8-cli ${current} → ${latest} 🎉\n`) +
            chalk.dim(`  Run ${replCmd("pax8 version")} to confirm.\n\n`),
        );
      }
      emit("upgraded");
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to upgrade pax8-cli");
    }
  });
