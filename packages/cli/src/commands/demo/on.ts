// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveConfig } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";

export const demoOnCommand = new Command("on")
  .description("Enable demo mode persistently in ~/.pax8/config.yaml")
  .addHelpText(
    "after",
    `
Examples:
  pax8 demo on
  pax8 demo on && pax8 dashboard

Persistent across CLI invocations. The PAX8_DEMO env var always wins
when set — see ${replCmd("pax8 demo status")} to inspect precedence.`
  )
  .action(async () => {
    const config = await loadConfig().catch(() => ({
      version: "1.0" as const,
    }));
    await saveConfig({ ...config, demo: true });

    process.stdout.write(
      chalk.green("\n  ✓ Demo mode enabled.\n") +
        chalk.dim(
          `  Next ${replCmd("pax8")} command runs against in-memory sample data.\n` +
            `  Run ${replCmd("pax8 demo off")} to return to live API calls.\n\n`,
        ),
    );

    const envDemo = process.env.PAX8_DEMO;
    if (envDemo === "0" || envDemo === "false") {
      process.stderr.write(
        chalk.yellow(
          `  ⚠ PAX8_DEMO=${envDemo} is set in your environment — it overrides this config.\n` +
            `    Demo mode will NOT activate until you unset the env var.\n\n`,
        ),
      );
    }
  });
