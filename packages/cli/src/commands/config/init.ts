// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import { getConfigDir } from "@pax8/core";

const DEFAULT_CONFIG = {
  version: "1.0",
  defaults: {
    output_format: "table",
    page_size: 50,
    confirm_destructive: true,
  },
  cache: {
    enabled: true,
    ttl_hours: 24,
  },
};

export const configInitCommand = new Command("init")
  .description("Create default configuration file")
  .option("--force", "Overwrite existing config")
  .addHelpText(
    "after",
    `
Examples:
  pax8 config init
  pax8 config init --force`
  )
  .action(async (options) => {
    const CONFIG_DIR = getConfigDir();
    const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
    try {
      const exists = await fs
        .access(CONFIG_FILE)
        .then(() => true)
        .catch(() => false);

      if (exists && !options.force) {
        process.stdout.write(
          chalk.yellow(
            `\n  Config already exists at ${CONFIG_FILE}\n  Use --force to overwrite\n\n`
          )
        );
        return;
      }

      await fs.mkdir(CONFIG_DIR, { recursive: true });
      const yamlContent = YAML.stringify(DEFAULT_CONFIG);
      await fs.writeFile(CONFIG_FILE, yamlContent, "utf-8");

      process.stdout.write(
        chalk.green(`\n  ✓ Config created at ${CONFIG_FILE}\n\n`)
      );
      process.stdout.write(chalk.dim(yamlContent) + "\n");
    } catch (error) {
      process.stderr.write(
        chalk.red(
          `\n  ✗ Failed to create config: ${error instanceof Error ? error.message : String(error)}\n\n`
        )
      );
      process.exit(1);
    }
  });
