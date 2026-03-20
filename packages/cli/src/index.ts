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
import { registerRecommendationsCommands } from "./commands/recommendations/index.js";
import { registerTelemetryCommands } from "./commands/telemetry/index.js";
import { statusCommand } from "./commands/status.js";
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
  registerRecommendationsCommands(program);
  registerTelemetryCommands(program);
  program.addCommand(statusCommand);
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

  const W = 48;
  const rule = chalk.cyan("\u2500".repeat(W));

  const pax8Art = [
    "    \u2588\u2588\u2588\u2588\u2588\u2588\u2557  \u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2557  \u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2557 ",
    "    \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557\u255a\u2588\u2588\u2557\u2588\u2588\u2554\u255d\u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557",
    "    \u2588\u2588\u2588\u2588\u2588\u2588\u2554\u255d\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2551 \u255a\u2588\u2588\u2588\u2554\u255d \u255a\u2588\u2588\u2588\u2588\u2588\u2554\u255d",
    "    \u2588\u2588\u2554\u2550\u2550\u2550\u255d \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2551 \u2588\u2588\u2554\u2588\u2588\u2557 \u2588\u2588\u2554\u2550\u2550\u2588\u2588\u2557",
    "    \u2588\u2588\u2551     \u2588\u2588\u2551  \u2588\u2588\u2551\u2588\u2588\u2554\u255d \u2588\u2588\u2557\u255a\u2588\u2588\u2588\u2588\u2588\u2554\u255d",
    "    \u255a\u2550\u255d     \u255a\u2550\u255d  \u255a\u2550\u255d\u255a\u2550\u255d  \u255a\u2550\u255d \u255a\u2550\u2550\u2550\u2550\u255d ",
  ];

  const subtitle = "    C O M M A N D   L I N E";
  const tagline = "   Manage your cloud marketplace from the terminal";
  const versionLine = `   v${version} \u00b7 Open Source \u00b7 Pax8 Labs`;

  const lines = [
    "",
    `  ${rule}`,
    "",
    ...pax8Art.map((l) => chalk.cyan.bold(`  ${l}`)),
    "",
    `  ${chalk.dim(subtitle)}`,
    "",
    `  ${chalk.dim(tagline)}`,
    `  ${chalk.dim(versionLine)}`,
    "",
    `  ${rule}`,
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

async function startRepl(): Promise<void> {
  const { createInterface } = await import("node:readline");

  showWelcomeScreen();
  process.stdout.write(chalk.dim("  Type a command, or ") + chalk.cyan("help") + chalk.dim(" / ") + chalk.cyan("exit") + "\n\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr, // prompt goes to stderr so stdout stays clean for piping
    prompt: chalk.cyan.bold("pax8> "),
    terminal: process.stdin.isTTY ?? false,
  });

  rl.prompt();

  // Process lines sequentially — readline doesn't await async callbacks,
  // so we queue them and use a sync wrapper to avoid unhandled rejections.
  let processing = false;
  const lineQueue: string[] = [];

  async function processLine(line: string): Promise<void> {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit" || input === "q") {
      rl.close();
      return;
    }

    if (input === "help") {
      const prog = createProgram();
      prog.outputHelp();
      process.stdout.write("\n");
      rl.prompt();
      return;
    }

    // Parse the input line into argv tokens (respects quoted strings)
    const args = tokenize(input);

    // Strip leading "pax8" if the user types it — the REPL already adds it
    if (args[0] === "pax8") {
      args.shift();
    }

    // Create a fresh program for each command to avoid stale state
    const prog = createProgram();
    prog.exitOverride(); // Don't call process.exit()
    prog.configureOutput({
      writeOut: (str: string) => process.stdout.write(str),
      writeErr: (str: string) => process.stderr.write(str),
    });

    // Override process.exit with a no-op so commands don't kill the REPL.
    // The error output is already written by handleCommandError before it
    // calls process.exit, so we just need to swallow the exit.
    const origExit = process.exit;
    process.exit = (() => {}) as typeof process.exit;

    try {
      await prog.parseAsync(["node", "pax8", ...args]);
    } catch (err: unknown) {
      const e = err as { code?: string; message?: string };
      // Suppress known non-error throws
      if (e?.code === "commander.helpDisplayed" || e?.code === "commander.version") {
        // Expected — help or version was printed
      } else if (e?.message === "process.exit intercepted") {
        // Expected — command error already printed, exit was swallowed
      } else if (err instanceof Error) {
        process.stderr.write(chalk.red.bold(`\n  \u2717 ${err.message}\n\n`));
      }
    } finally {
      process.exit = origExit;
    }

    process.stdout.write("\n");
    rl.prompt();
  }

  rl.on("line", (line: string) => {
    lineQueue.push(line);
    if (!processing) {
      processing = true;
      (async () => {
        while (lineQueue.length > 0) {
          const next = lineQueue.shift()!;
          try {
            await processLine(next);
          } catch {
            // Never let an error kill the REPL — just re-prompt
            process.stdout.write("\n");
            rl.prompt();
          }
        }
        processing = false;
      })();
    }
  });

  return new Promise<void>((resolve) => {
    rl.on("close", () => {
      process.stdout.write(chalk.dim("\n  Goodbye.\n\n"));
      resolve();
    });
  });
}

/**
 * Tokenize a command line string, respecting quoted strings.
 * "companies more "Acme Corp" --json" → ["companies", "more", "Acme Corp", "--json"]
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

async function main(): Promise<void> {
  if (process.argv.length <= 2) {
    if (process.stdin.isTTY) {
      await startRepl();
    } else {
      showWelcomeScreen();
    }
  } else {
    const program = createProgram();
    await program.parseAsync(process.argv).catch((err) => {
      handleCommandError(err);
    });
  }
}

main();
