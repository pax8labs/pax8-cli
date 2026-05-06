import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INTERNAL, loadConfig, saveConfig } from "@pax8/core";
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
Examples:
  pax8 init                Create default config at ~/.pax8/config.yaml
  pax8 init --force        Overwrite an existing config with defaults
  pax8 init --demo         Enable demo mode persistently (no credentials needed)
  pax8 init --demo off     Disable demo mode and return to live API`
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
            chalk.green(`\n  ✓ Demo mode enabled. Try: ${replCmd("pax8 companies list")}\n`)
          );
          process.stdout.write(
            chalk.dim(`  Disable with: ${replCmd("pax8 init --demo off")}\n\n`)
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
      throw new CliError(
        "Failed to initialize Pax8 configuration",
        [
          detail,
          "The config directory (~/.pax8) may not be writable, or an existing config could not be updated.",
        ],
        [
          `Check that the config directory is writable: ${chalk.cyan("ls -ld ~/.pax8")}`,
          `Overwrite a corrupt config with defaults: ${chalk.cyan(replCmd("pax8 init --force"))}`,
          `Skip credential setup and try sample data: ${chalk.cyan(replCmd("pax8 init --demo"))}`,
        ],
        "https://devx.pax8.com/",
        ERROR_INTERNAL,
      );
    }
  });
