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
import { registerReportCommands } from "./commands/report/index.js";
import { registerUsageCommands } from "./commands/usage/index.js";
import { registerWebhooksCommands } from "./commands/webhooks/index.js";
import { registerContactsCommands } from "./commands/contacts/index.js";
import { registerQuotesCommands } from "./commands/quotes/index.js";
import { registerCostCommands } from "./commands/cost/index.js";
import { statusCommand } from "./commands/status.js";
import { doctorCommand } from "./commands/doctor.js";
import { completionsCommand } from "./commands/completions.js";
import { versionCommand } from "./commands/version.js";
import { initCommand } from "./commands/init.js";
import { handleCommandError } from "./lib/errors.js";
import { installSigintHandler } from "./lib/signals.js";
import { mooCommand } from "./commands/easter-eggs/moo.js";
import { coffeeCommand } from "./commands/easter-eggs/coffee.js";
import { getTimeQuip } from "./commands/easter-eggs/time-quip.js";
import { loadConfig, getTelemetry } from "@pax8/core";
import type { Command as CommandType } from "commander";
import { classifyError } from "./lib/instrumented-action.js";

/**
 * Build the full dotted command name from a Commander command,
 * e.g. "companies.list", "subscriptions.show", "auth.login"
 */
function getFullCommandName(cmd: CommandType): string {
  const parts: string[] = [];
  let current: CommandType | null = cmd;
  while (current) {
    const name = current.name();
    if (name && name !== "pax8") {
      parts.unshift(name);
    }
    current = current.parent;
  }
  return parts.join(".") || "unknown";
}

/**
 * Extract active flag names from a Commander command's options.
 * Only includes flags that were explicitly set (not defaults).
 */
function extractCommandFlags(cmd: CommandType): string[] {
  const flags: string[] = [];
  try {
    const opts = cmd.opts();
    for (const key of Object.keys(opts)) {
      const val = opts[key];
      if (val !== undefined && val !== false) {
        const flag = "--" + key.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());
        flags.push(flag);
      }
    }
  } catch {
    // If opts() throws, return empty
  }
  return flags.sort();
}

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
  registerReportCommands(program);
  registerUsageCommands(program);
  registerWebhooksCommands(program);
  registerContactsCommands(program);
  registerQuotesCommands(program);
  registerCostCommands(program);
  program.addCommand(statusCommand);
  program.addCommand(initCommand);
  program.addCommand(doctorCommand);
  program.addCommand(completionsCommand);
  program.addCommand(versionCommand);

  // Easter egg commands (hidden from main help)
  program.addCommand(mooCommand, { hidden: true });
  program.addCommand(coffeeCommand, { hidden: true });

  // ── Telemetry: record start time before every command ───────────────
  const commandStartTimes = new WeakMap<CommandType, number>();

  // Time-based quip hook and demo mode banner
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    // Record start time for duration tracking
    commandStartTimes.set(actionCommand, Date.now());

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

    // Load telemetry enabled state (reads config once)
    try {
      const telemetry = getTelemetry();
      await telemetry.loadEnabled();
    } catch {
      // Never block the CLI on telemetry init
    }
  });

  // ── Telemetry: track successful command execution ──────────────────
  program.hook("postAction", async (_thisCommand, actionCommand) => {
    try {
      const telemetry = getTelemetry();
      if (!telemetry.isEnabled()) return;

      const startTime = commandStartTimes.get(actionCommand) ?? Date.now();
      const subcommand = getFullCommandName(actionCommand);
      const flags = extractCommandFlags(actionCommand);
      const isDemo = process.env.PAX8_DEMO === "1" || false;

      telemetry.track({
        event: "command_executed",
        command: subcommand.split(".")[0] ?? subcommand,
        subcommand,
        flags,
        duration_ms: Date.now() - startTime,
        success: true,
        cli_version: typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0",
        node_version: process.version,
        os: process.platform,
        demo_mode: isDemo,
      });

      // Fire-and-forget flush
      telemetry.flush().then(() => telemetry.shutdown()).catch(() => {});
    } catch {
      // Telemetry must never crash the CLI
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
    `    ${chalk.cyan("auth login")}        ${chalk.dim("Set up API credentials")}`,
    `    ${chalk.cyan("init --demo")}       ${chalk.dim("Try with sample data")}`,
    `    ${chalk.cyan("companies list")}    ${chalk.dim("List your customers")}`,
    `    ${chalk.cyan("doctor")}            ${chalk.dim("Check your setup")}`,
    "",
    `  ${chalk.dim("Run")} help ${chalk.dim("for all commands.")}`,
    "",
  ];
  process.stdout.write(lines.join("\n"));
}

async function startRepl(): Promise<void> {
  const { createInterface } = await import("node:readline");
  const { spawn } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  const { resolve: resolvePath } = await import("node:path");
  const path = await import("node:path");
  const fs = await import("node:fs");
  const { homedir } = await import("node:os");

  const cliPath = resolvePath(fileURLToPath(import.meta.url), "../index.js");

  showWelcomeScreen();
  process.stdout.write(chalk.dim("  Type a command, or ") + chalk.cyan("help") + chalk.dim(" / ") + chalk.cyan("exit") + "\n\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: chalk.cyan.bold("pax8> "),
    terminal: process.stdin.isTTY ?? false,
  });

  rl.prompt();

  rl.on("line", (line: string) => {
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

    let args = tokenize(input);
    if (args[0] === "pax8") {
      args.shift();
    }

    // Handle bare number input — check for pending actions from last list/recommendations
    if (args.length === 1 && /^\d+$/.test(args[0])) {
      try {
        const actionsPath = path.join(homedir(), ".pax8", "pending-actions.json");
        const raw = JSON.parse(fs.readFileSync(actionsPath, "utf-8"));
        // Validate shape before trusting — prevent command injection via file tampering
        const actions = Array.isArray(raw) ? raw.filter(
          (a: unknown): a is { key: string; command?: string; rec?: { orderCommand?: string; suggestedProducts?: string[] } } =>
            typeof a === "object" && a !== null &&
            typeof (a as Record<string, unknown>).key === "string" &&
            ((a as Record<string, unknown>).command === undefined || typeof (a as Record<string, unknown>).command === "string") &&
            ((a as Record<string, unknown>).rec === undefined || typeof (a as Record<string, unknown>).rec === "object")
        ) : [];
        const picked = actions.find((a) => a.key === args[0]);
        if (picked) {
          if (picked.command && /^pax8\s+\w/.test(picked.command)) {
            // Generic command template (e.g. from companies list) — must start with "pax8 <subcommand>"
            args = tokenize(picked.command.replace(/^pax8\s+/, ""));
          } else if (picked.rec) {
            // Recommendation action
            if (picked.rec.orderCommand && /^pax8\s+orders\s+create\b/.test(picked.rec.orderCommand)) {
              // Only allow order create commands from recommendations
              args = tokenize(picked.rec.orderCommand.replace(/^pax8\s+/, ""));
            } else {
              const searchTerm = picked.rec.suggestedProducts?.[0] ?? "product";
              args = ["products", "search", searchTerm];
            }
          }
        }
      } catch { /* no pending actions */ }
    }

    // Run each command as a child process so it can never crash the REPL.
    // Use "inherit" for all stdio so the child gets the real TTY
    // (needed for table output detection and spinner animations).
    // Pause the REPL readline while the child runs so stdin input
    // (like "y" for confirmations) doesn't leak back to the REPL.
    rl.pause();
    const child = spawn("node", [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: "1", PAX8_REPL: "1" },
      stdio: "inherit",
    });

    child.on("close", () => {
      process.stdout.write("\n");
      rl.resume();
      rl.prompt();
    });
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
 * "companies more "Acme Corp" --json" -> ["companies", "more", "Acme Corp", "--json"]
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
  // Install the SIGINT handler before doing anything else so Ctrl+C during
  // startup (token loading, config parsing, cache warmer spawn) still gets
  // the clean cleanup path rather than Node's default `1` exit.
  installSigintHandler();

  if (process.argv.length <= 2) {
    if (process.stdin.isTTY) {
      await startRepl();
    } else {
      showWelcomeScreen();
    }
  } else {
    const program = createProgram();
    await program.parseAsync(process.argv).catch(async (err) => {
      // Track failed command execution via telemetry
      try {
        const telemetry = getTelemetry();
        if (telemetry.isEnabled()) {
          // Determine which command was attempted from argv
          const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
          const subcommand = args.join(".") || "unknown";

          telemetry.track({
            event: "command_executed",
            command: args[0] ?? "unknown",
            subcommand,
            flags: process.argv.slice(2).filter((a) => a.startsWith("--")).sort(),
            duration_ms: 0, // Duration not available for top-level errors
            success: false,
            error_code: classifyError(err),
            cli_version: typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0",
            node_version: process.version,
            os: process.platform,
            demo_mode: process.env.PAX8_DEMO === "1",
          });

          await telemetry.flush().catch(() => {});
          await telemetry.shutdown().catch(() => {});
        }
      } catch {
        // Telemetry must never interfere with error handling
      }

      handleCommandError(err);
    });
  }
}

main();
