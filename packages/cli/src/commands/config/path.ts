import { Command } from "commander";
import * as path from "node:path";
import * as os from "node:os";

const CONFIG_DIR = path.join(os.homedir(), ".pax8");

export const configPathCommand = new Command("path")
  .description("Print config directory path")
  .addHelpText(
    "after",
    `
Examples:
  pax8 config path`
  )
  .action(async () => {
    process.stdout.write(CONFIG_DIR + "\n");
  });
