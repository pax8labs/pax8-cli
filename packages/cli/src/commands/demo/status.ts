// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { loadConfig } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";

type Source = "env" | "config" | "default";

interface DemoStatus {
  enabled: boolean;
  source: Source;
}

function resolveStatus(envValue: string | undefined, configDemo: boolean | undefined): DemoStatus {
  if (envValue === "1" || envValue === "true") return { enabled: true, source: "env" };
  if (envValue === "0" || envValue === "false") return { enabled: false, source: "env" };
  if (configDemo === true) return { enabled: true, source: "config" };
  if (configDemo === false) return { enabled: false, source: "config" };
  return { enabled: false, source: "default" };
}

export const demoStatusCommand = new Command("status")
  .description("Show whether demo mode is on, off, and which source determined it")
  .option("--json", "Output as JSON")
  .addHelpText(
    "after",
    `
Examples:
  pax8 demo status
  pax8 demo status --json

Reports the resolved demo state and which source set it:
  - env       PAX8_DEMO env var was set (1/true/0/false) — always wins
  - config    ~/.pax8/config.yaml has demo: true|false
  - default   Neither set; demo mode is off`
  )
  .action(async (options: { json?: boolean }, command) => {
    const envValue = process.env.PAX8_DEMO;
    const config = await loadConfig().catch(() => ({}) as { demo?: boolean });
    const status = resolveStatus(envValue, config.demo);

    // Honor the parent program's `--json` global flag in addition to
    // local `--json` so `pax8 --json demo status` works the same way
    // it does for every other read command.
    const wantsJson = options.json || command.optsWithGlobals?.()?.json === true;

    if (wantsJson) {
      process.stdout.write(JSON.stringify(status, null, 2) + "\n");
      return;
    }

    const onOff = status.enabled ? chalk.green("ON") : chalk.dim("OFF");
    process.stdout.write(`\n  Demo mode: ${onOff}\n`);

    if (status.source === "env") {
      process.stdout.write(
        chalk.dim(
          `  Source:    PAX8_DEMO=${envValue} (env var overrides config)\n\n`,
        ),
      );
    } else if (status.source === "config") {
      process.stdout.write(
        chalk.dim(`  Source:    ~/.pax8/config.yaml — demo: ${config.demo}\n\n`),
      );
    } else {
      process.stdout.write(
        chalk.dim(
          `  Source:    default (no env var, no config setting)\n` +
            `  Enable:    ${replCmd("pax8 demo on")}\n\n`,
        ),
      );
    }
  });
