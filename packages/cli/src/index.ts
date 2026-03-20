import { Command } from "commander";
import chalk from "chalk";

declare const __CLI_VERSION__: string;
import { registerAuthCommands } from "./commands/auth/index.js";
import { registerConfigCommands } from "./commands/config/index.js";
import { registerCompaniesCommands } from "./commands/companies/index.js";
import { registerSubscriptionsCommands } from "./commands/subscriptions/index.js";
import { registerProductsCommands } from "./commands/products/index.js";
import { registerInvoicesCommands } from "./commands/invoices/index.js";
import { registerOrdersCommands } from "./commands/orders/index.js";
import { registerTelemetryCommands } from "./commands/telemetry/index.js";
import { doctorCommand } from "./commands/doctor.js";
import { completionsCommand } from "./commands/completions.js";
import { versionCommand } from "./commands/version.js";
import { initCommand } from "./commands/init.js";
import { handleCommandError } from "./lib/errors.js";
import { mooCommand } from "./commands/easter-eggs/moo.js";
import { coffeeCommand } from "./commands/easter-eggs/coffee.js";
import { getTimeQuip } from "./commands/easter-eggs/time-quip.js";
import { loadConfig } from "@pax8/core";

export function createProgram(): Command {
  const program = new Command();
  program
    .name("pax8")
    .description("Pax8 open source CLI \u2014 manage cloud marketplace operations from the terminal")
    .version(typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0")
    .option("--json", "Output as JSON")
    .option("--csv", "Output as CSV")
    .option("--quiet", "Suppress all output")
    .option("--verbose", "Show detailed output")
    .option("--no-color", "Disable color output")
    .option("--config <path>", "Path to config file");

  // Register command groups
  registerAuthCommands(program);
  registerConfigCommands(program);
  registerCompaniesCommands(program);
  registerSubscriptionsCommands(program);
  registerProductsCommands(program);
  registerInvoicesCommands(program);
  registerOrdersCommands(program);
  registerTelemetryCommands(program);
  program.addCommand(initCommand);
  program.addCommand(doctorCommand);
  program.addCommand(completionsCommand);
  program.addCommand(versionCommand);

  // Easter egg commands (hidden from main help)
  program.addCommand(mooCommand, { hidden: true });
  program.addCommand(coffeeCommand, { hidden: true });

  // Time-based quip hook and demo mode banner
  program.hook("preAction", async () => {
    const quip = getTimeQuip();
    if (quip) {
      console.error(quip);
    }

    // Show demo mode banner if active
    let isDemo = process.env.PAX8_DEMO === "1";
    if (!isDemo) {
      try {
        const config = await loadConfig();
        isDemo = config.demo === true;
      } catch {
        // ignore config load errors
      }
    }
    if (isDemo) {
      process.stderr.write(chalk.dim("  \u2728 Demo mode \u2014 showing sample data\n"));
    }
  });

  return program;
}

function showWelcomeScreen(): void {
  const version = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";
  const W = 58;
  const border = "\u2550".repeat(W);
  const pad = (text: string, visLen: number) =>
    chalk.cyan.bold("\u2551") + text + " ".repeat(W - visLen) + chalk.cyan.bold("\u2551");
  const empty = pad("", 0);

  const pax8Art = [
    ["    ██████╗  █████╗ ██╗  ██╗ █████╗ ", 36],
    ["    ██╔══██╗██╔══██╗╚██╗██╔╝██╔══██╗", 36],
    ["    ██████╔╝███████║ ╚███╔╝ ╚█████╔╝", 36],
    ["    ██╔═══╝ ██╔══██║ ██╔██╗ ██╔══██╗", 36],
    ["    ██║     ██║  ██║██╔╝ ██╗╚█████╔╝", 36],
    ["    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝ ╚════╝ ", 37],
  ] as const;

  const subtitle = "    C O M M A N D   L I N E";

  const tagline = "   Manage your cloud marketplace from the terminal";
  const versionLine = `   v${version} \u00b7 Open Source \u00b7 Pax8 Labs`;

  const lines = [
    "",
    chalk.cyan.bold("\u2554" + border + "\u2557"),
    empty,
    ...pax8Art.map(([text, len]) => pad(text, len as number)),
    empty,
    pad(subtitle, subtitle.length),
    empty,
    pad(tagline, tagline.length),
    pad(versionLine, versionLine.length),
    empty,
    chalk.cyan.bold("\u255a" + border + "\u255d"),
    "",
    `  ${chalk.dim("Get started:")}`,
    `    ${chalk.cyan("pax8 auth login")}        ${chalk.dim("Set up API credentials")}`,
    `    ${chalk.cyan("pax8 init --demo")}       ${chalk.dim("Try with sample data")}`,
    `    ${chalk.cyan("pax8 companies list")}    ${chalk.dim("List your customers")}`,
    `    ${chalk.cyan("pax8 doctor")}            ${chalk.dim("Check your setup")}`,
    "",
    `  ${chalk.dim("Run")} pax8 --help ${chalk.dim("for all commands.")}`,
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

const program = createProgram();

// Show welcome screen when no subcommand is provided
if (process.argv.length <= 2) {
  showWelcomeScreen();
} else {
  program.parseAsync(process.argv).catch((err) => {
    handleCommandError(err);
  });
}
