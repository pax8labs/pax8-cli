// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigDir, loadConfig } from "@pax8/core";

const CACHE_DIR = path.join(getConfigDir(), "cache");

const cacheStatusCommand = new Command("status")
  .description("Show response cache status, location, and size")
  .action(async () => {
    const noCache = process.env.PAX8_NO_CACHE === "1" || process.env.PAX8_NO_CACHE === "true";
    let cacheEnabled = false;
    let ttlHours = 24;
    if (!noCache) {
      try {
        const cfg = await loadConfig();
        cacheEnabled = cfg.cache?.enabled ?? false;
        ttlHours = cfg.cache?.ttl_hours ?? 24;
      } catch {
        // config unreadable — treat as disabled
      }
    }

    let entryCount = 0;
    let totalBytes = 0;
    try {
      const files = await fs.readdir(CACHE_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      entryCount = jsonFiles.length;
      for (const f of jsonFiles) {
        try {
          const stat = await fs.stat(path.join(CACHE_DIR, f));
          totalBytes += stat.size;
        } catch {
          // skip
        }
      }
    } catch {
      // cache dir doesn't exist yet
    }

    const kb = (totalBytes / 1024).toFixed(1);
    const active = !noCache && cacheEnabled;

    process.stdout.write("\n");
    process.stdout.write(
      `  Cache:    ${active ? chalk.green("enabled") : chalk.yellow("disabled")}\n`,
    );
    if (noCache) {
      process.stdout.write(`  Reason:   PAX8_NO_CACHE env var is set\n`);
    } else if (!cacheEnabled) {
      process.stdout.write(
        `  To enable: set ${chalk.dim("cache.enabled: true")} in ~/.pax8/config.yaml\n`,
      );
    } else {
      process.stdout.write(`  TTL:      ${ttlHours}h\n`);
    }
    process.stdout.write(`  Location: ${CACHE_DIR}\n`);
    process.stdout.write(
      `  Entries:  ${entryCount > 0 ? `${entryCount} (${kb} KB)` : "empty"}\n`,
    );
    if (entryCount > 0) {
      process.stdout.write(
        `\n  Run ${chalk.dim("pax8 cache clear")} to remove all cached responses.\n`,
      );
    }
    process.stdout.write("\n");
  });

const cacheClearCommand = new Command("clear")
  .description("Remove all cached API responses")
  .action(async () => {
    try {
      const files = await fs.readdir(CACHE_DIR);
      const jsonFiles = files.filter((f) => f.endsWith(".json"));
      if (jsonFiles.length === 0) {
        process.stdout.write("\n  Cache is already empty.\n\n");
        return;
      }
      await Promise.all(
        jsonFiles.map((f) => fs.unlink(path.join(CACHE_DIR, f)).catch(() => {})),
      );
      process.stdout.write(
        `\n  ${chalk.green("✓")} Cleared ${jsonFiles.length} cached ${jsonFiles.length === 1 ? "entry" : "entries"}.\n\n`,
      );
    } catch {
      process.stdout.write("\n  Cache is already empty.\n\n");
    }
  });

export function registerCacheCommands(program: Command): void {
  const cache = new Command("cache").description("Manage the local API response cache");
  cache.addCommand(cacheStatusCommand);
  cache.addCommand(cacheClearCommand);
  program.addCommand(cache);
}
