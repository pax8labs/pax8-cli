// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import YAML from "yaml";
import { ConfigSchema, getConfigDir, ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";

/**
 * The schema requires this, and nothing else stamps it on the write path
 * (#729). `config set` on a config dir with no `config.yaml` used to
 * produce a file without it — which fails validation, is silently
 * discarded on every subsequent load, and makes the command's "✓ Set
 * demo = true" a lie. `pax8 init` / `config init` write it; this is the
 * other door into the same file.
 */
const CONFIG_VERSION = "1.0";

function setNestedValue(obj: Record<string, unknown>, keyPath: string, value: string): void {
  const keys = keyPath.split(".");
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (current[keys[i]] === undefined || typeof current[keys[i]] !== "object") {
      current[keys[i]] = {};
    }
    current = current[keys[i]] as Record<string, unknown>;
  }
  // Attempt to parse value as number or boolean
  let parsed: unknown = value;
  if (value === "true") parsed = true;
  else if (value === "false") parsed = false;
  else if (/^\d+$/.test(value)) parsed = parseInt(value, 10);

  current[keys[keys.length - 1]] = parsed;
}

/** Read a dot-path out of a parsed object, or `undefined` if absent. */
function getNestedValue(obj: unknown, keyPath: string): unknown {
  let current: unknown = obj;
  for (const key of keyPath.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export const configSetCommand = new Command("set")
  .description("Set a configuration value (dot notation)")
  .argument("<key>", "Configuration key (e.g., defaults.output_format)")
  .argument("<value>", "Value to set")
  .addHelpText(
    "after",
    `
Examples:
  pax8 config set defaults.output_format json
  pax8 config set defaults.page_size 25
  pax8 config set cache.enabled false`
  )
  .action(async (key: string, value: string) => {
    const CONFIG_DIR = getConfigDir();
    const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
    try {
      let config: Record<string, unknown> = {};
      try {
        const content = await fs.readFile(CONFIG_FILE, "utf-8");
        config = YAML.parse(content) ?? {};
      } catch {
        // Start with empty config if file doesn't exist
      }

      // Stamp the version on a file that lacks one — a fresh dir, or a
      // file an older build of this command already wrote without it.
      if (config.version === undefined) config.version = CONFIG_VERSION;

      setNestedValue(config, key, value);

      // Validate BEFORE writing. Persisting an invalid file is what made
      // the original bug silent: every later `loadConfig()` discarded the
      // whole file, so the setting never applied and nothing said so.
      const result = ConfigSchema.safeParse(config);
      if (!result.success) {
        throw new CliError(
          `"${key}" can't be set to "${value}"`,
          result.error.issues.map((i) => {
            const p = i.path.length > 0 ? i.path.join(".") : "(root)";
            return `${p}: ${i.message}`;
          }),
          [
            `Check the accepted values: ${replCmd("pax8 config show")}`,
            `Or start from a fresh config: ${replCmd("pax8 config init")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // The schema strips keys it doesn't know, so a typo'd key would
      // otherwise "succeed" and silently write nothing usable. If the key
      // didn't survive the parse, it isn't a real setting.
      if (getNestedValue(result.data, key) === undefined) {
        throw new CliError(
          `"${key}" is not a recognized configuration key`,
          ["It would be dropped the next time the config is read"],
          [
            `List the keys that exist: ${replCmd("pax8 config show")}`,
            "Top-level keys: demo, auth, defaults, cache, telemetry",
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      await fs.mkdir(CONFIG_DIR, { recursive: true });
      // Write the sparse object rather than `result.data`: parsing
      // materializes every schema default, which would freeze today's
      // defaults into the user's file and stop future changes reaching them.
      const yamlContent = YAML.stringify(config);
      await fs.writeFile(CONFIG_FILE, yamlContent, "utf-8");

      process.stdout.write(
        chalk.green(`\n  ✓ Set ${key} = ${value}\n\n`)
      );
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to set config");
    }
  });
