import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import YAML from "yaml";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");

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
    try {
      let config: Record<string, unknown> = {};
      try {
        const content = await fs.readFile(CONFIG_FILE, "utf-8");
        config = YAML.parse(content) ?? {};
      } catch {
        // Start with empty config if file doesn't exist
      }

      setNestedValue(config, key, value);

      await fs.mkdir(CONFIG_DIR, { recursive: true });
      const yamlContent = YAML.stringify(config);
      await fs.writeFile(CONFIG_FILE, yamlContent, "utf-8");

      process.stdout.write(
        chalk.green(`\n  ✓ Set ${key} = ${value}\n\n`)
      );
    } catch (error) {
      process.stderr.write(
        chalk.red(
          `\n  ✗ Failed to set config: ${error instanceof Error ? error.message : String(error)}\n\n`
        )
      );
      process.exit(1);
    }
  });
