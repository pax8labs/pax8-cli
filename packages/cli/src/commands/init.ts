// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INTERNAL, getConfigDir, loadConfig, saveConfig } from "@pax8/core";
import type { Config } from "@pax8/core";
import { replCmd } from "../lib/confirm.js";
import { CliError } from "../lib/errors.js";

export const initCommand = new Command("init")
  .description("Initialize configuration (or enable demo mode)")
  .option("--demo [value]", "Enable or disable persistent demo mode (use 'off' to disable)")
  .option("--force", "Overwrite existing config")
  .addHelpText(
    "after",
    `
Config root:
  Resolved at runtime from $PAX8_CONFIG_DIR (defaults to $HOME/.pax8).

Examples:
  pax8 init                Create default config at <config-dir>/config.yaml
  pax8 init --force        Overwrite an existing config with defaults
  pax8 init --demo         Enable demo mode persistently (no credentials needed)
  pax8 demo off            Disable demo mode and return to live API

For one-shot demo runs (no persistence), prefer:
  PAX8_DEMO=1 pax8 dashboard       (macOS/Linux)
  $env:PAX8_DEMO="1"; pax8 dashboard   (PowerShell)`
  )
  .action(async (options) => {
    try {
      if (options.demo !== undefined) {
        // Handle demo mode toggle
        const disabling = options.demo === "off";
        const config: Config = await loadConfig().catch(() => ({
          version: "1.0" as const,
          defaults: {
            output_format: "table" as const,
            page_size: 50,
            confirm_destructive: true,
          },
          cache: { enabled: true, ttl_hours: 24 },
          telemetry: { enabled: false },
        }));

        if (disabling) {
          config.demo = false;
          await saveConfig(config);
          process.stdout.write(
            chalk.green("\n  ✓ Demo mode disabled.\n\n")
          );
        } else {
          config.demo = true;
          await saveConfig(config);
          process.stdout.write(
            chalk.green(`\n  ✓ Demo mode enabled (persistent). Try: ${replCmd("pax8 clients list")}\n`)
          );
          // Wording matches `auth status`, `auth login`, and `doctor` — all
          // four point at `pax8 demo off`. Previously this one said
          // `pax8 init --demo off`, which works but creates two ways to say
          // the same thing and made the "where's demo coming from?" debug
          // path harder to follow.
          process.stdout.write(
            chalk.dim(`  Disable with: ${replCmd("pax8 demo off")}\n\n`)
          );
        }
        return;
      }

      // Delegate to config init behavior
      const { configInitCommand } = await import("./config/init.js");
      await configInitCommand.parseAsync(
        options.force ? ["node", "init", "--force"] : ["node", "init"],
        { from: "user" }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      // #459: render the resolved config path rather than hardcoding ~/.pax8
      // so the recovery hints stay accurate under PAX8_CONFIG_DIR overrides
      // (CI, sandboxes, multi-workspace setups).
      let configDir: string;
      try {
        configDir = getConfigDir();
      } catch {
        // getConfigDir() can throw via validateConfigDir if PAX8_CONFIG_DIR
        // resolves outside $HOME without the opt-out. Fall back to a
        // description so the error message stays helpful.
        configDir = "$PAX8_CONFIG_DIR (or $HOME/.pax8)";
      }
      const configDirShellEscaped = configDir.replace(/'/g, "'\\''");
      throw new CliError(
        "Failed to initialize Pax8 configuration",
        [
          detail,
          `The config directory (${configDir}) may not be writable, or an existing config could not be updated.`,
        ],
        [
          `Check that the config directory is writable: ${chalk.cyan(`ls -ld '${configDirShellEscaped}'`)}`,
          `Overwrite a corrupt config with defaults: ${chalk.cyan(replCmd("pax8 init --force"))}`,
          `Skip credential setup and try sample data: ${chalk.cyan(replCmd("pax8 init --demo"))}`,
          `Or point the CLI at a different config root: ${chalk.cyan("export PAX8_CONFIG_DIR=<path>")}`,
        ],
        "https://devx.pax8.com/",
        ERROR_INTERNAL,
      );
    }
  });
