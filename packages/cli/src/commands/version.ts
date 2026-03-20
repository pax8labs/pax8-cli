import { Command } from "commander";

export const versionCommand = new Command("version")
  .description("Print version information")
  .addHelpText(
    "after",
    `
Examples:
  pax8 version`
  )
  .action(async () => {
    const version = "0.1.0";
    const nodeVersion = process.versions.node;
    const platform = `${process.platform}-${process.arch}`;

    process.stdout.write(`pax8-cli ${version}\n`);
    process.stdout.write(`node     v${nodeVersion}\n`);
    process.stdout.write(`platform ${platform}\n`);
  });
