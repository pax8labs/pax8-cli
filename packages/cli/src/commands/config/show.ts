import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { replCmd } from "../../lib/confirm.js";
import YAML from "yaml";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");

export const configShowCommand = new Command("show")
  .description("Display current configuration")
  .addHelpText(
    "after",
    `
Examples:
  pax8 config show`
  )
  .action(async () => {
    try {
      const content = await fs.readFile(CONFIG_FILE, "utf-8");
      process.stdout.write(content);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        process.stdout.write(
          chalk.yellow(
            `\n  No config file found at ${CONFIG_FILE}\n  Run: ${replCmd("pax8 config init")}\n\n`
          )
        );
      } else {
        process.stderr.write(
          chalk.red(
            `\n  ✗ Failed to read config: ${err instanceof Error ? err.message : String(err)}\n\n`
          )
        );
        process.exit(1);
      }
    }
  });
