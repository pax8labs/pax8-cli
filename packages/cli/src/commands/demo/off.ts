// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";

export const demoOffCommand = new Command("off")
  .description("Disable demo mode (return to live Pax8 API calls)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 demo off
  pax8 demo off && pax8 dashboard

This clears the persistent demo flag in ~/.pax8/config.yaml. The
PAX8_DEMO env var still wins when set — see ${replCmd("pax8 demo status")}.`
  )
  .action(async () => {
    const config = await loadConfig().catch(() => ({
      version: "1.0" as const,
    }));
    // Setting to `false` rather than deleting keeps the field explicit
    // in the saved YAML — partners reading their config file should see
    // demo: false rather than an absent field they have to infer.
    await saveConfig({ ...config, demo: false });

    process.stdout.write(
      chalk.green("\n  ✓ Demo mode disabled.\n") +
        chalk.dim(
          `  Next ${replCmd("pax8")} command runs against the live Pax8 API.\n` +
            `  Run ${replCmd("pax8 auth login")} if you haven't authenticated yet.\n\n`,
        ),
    );

    const envDemo = process.env.PAX8_DEMO;
    if (envDemo === "1" || envDemo === "true") {
      process.stderr.write(
        chalk.yellow(
          `  ⚠ PAX8_DEMO=${envDemo} is set in your environment — it overrides this config.\n` +
            `    Demo mode WILL stay active until you unset the env var.\n\n`,
        ),
      );
    }
  });
