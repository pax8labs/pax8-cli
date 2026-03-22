import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "@pax8/core";
import { replCmd } from "../lib/confirm.js";

export const initCommand = new Command("init")
  .description("Initialize configuration (or enable demo mode)")
  .option("--demo [value]", "Enable or disable persistent demo mode (use 'off' to disable)")
  .option("--force", "Overwrite existing config")
  .addHelpText(
    "after",
    `
Examples:
  pax8 init              Create default config
  pax8 init --demo       Enable demo mode persistently
  pax8 init --demo off   Disable demo mode`
  )
  .action(async (options) => {
    try {
      if (options.demo !== undefined) {
        // Handle demo mode toggle
        const disabling = options.demo === "off";
        const config = await loadConfig().catch(() => ({
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
            chalk.green("\n  \u2713 Demo mode disabled.\n\n")
          );
        } else {
          config.demo = true;
          await saveConfig(config);
          process.stdout.write(
            chalk.green(`\n  \u2713 Demo mode enabled. Try: ${replCmd("pax8 companies list")}\n`)
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
      process.stderr.write(
        chalk.red(
          `\n  \u2717 Failed: ${error instanceof Error ? error.message : String(error)}\n\n`
        )
      );
      process.exit(1);
    }
  });
