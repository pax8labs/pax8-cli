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
import { reportBugCommand } from "./commands/report-bug.js";
import { handleCommandError, flushTelemetryBeforeExit } from "./lib/errors.js";
import { installSigintHandler } from "./lib/signals.js";
import { consumeTelemetryFields } from "./lib/telemetry-context.js";
import { mooCommand } from "./commands/easter-eggs/moo.js";
import { coffeeCommand } from "./commands/easter-eggs/coffee.js";
import { getTimeQuip } from "./commands/easter-eggs/time-quip.js";
import { loadConfig, getTelemetry } from "@pax8/core";
import type { Command as CommandType } from "commander";
import { startRepl } from "./lib/repl.js";
import { showWelcomeScreen } from "./lib/welcome.js";

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
    .description("Pax8 open source CLI — manage cloud marketplace operations from the terminal")
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
  program.addCommand(reportBugCommand());

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
      process.stderr.write(quip + "\n");
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
      process.stderr.write(chalk.dim("  ✨ Demo mode — showing sample data\n"));
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
      // Always consume so a leftover from a (rare) early-returning handler
      // doesn't leak into a later command run in the same process (REPL).
      const handlerProps = consumeTelemetryFields();
      if (!telemetry.isEnabled()) return;

      const startTime = commandStartTimes.get(actionCommand) ?? Date.now();
      const subcommand = getFullCommandName(actionCommand);
      const flags = extractCommandFlags(actionCommand);
      const isDemo = process.env.PAX8_DEMO === "1" || false;

      // Single canonical event for every command run (#146). Handlers
      // contribute aggregate counters via setTelemetryFields(); they no
      // longer call telemetry.track() directly.
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
        ...handlerProps,
      });

      // Fire-and-forget flush
      telemetry.flush().then(() => telemetry.shutdown()).catch(() => {});
    } catch {
      // Telemetry must never crash the CLI
    }
  });

  return program;
}

async function main(): Promise<void> {
  // Install the SIGINT handler before doing anything else so Ctrl+C during
  // startup (token loading, config parsing, cache warmer spawn) still gets
  // the clean cleanup path rather than Node's default `1` exit.
  installSigintHandler();

  // Last-resort handlers for crashes that escape `parseAsync.catch`. Without
  // these the process would exit before the PostHog buffer flushed, so the
  // failure event would be lost (#145). We delegate to `handleCommandError`
  // which now awaits the bounded telemetry shutdown before exit.
  process.on("uncaughtException", (err) => {
    void handleCommandError(err).catch(() => process.exit(1));
  });
  process.on("unhandledRejection", (reason) => {
    void handleCommandError(reason).catch(() => process.exit(1));
  });

  if (process.argv.length <= 2) {
    if (process.stdin.isTTY) {
      await startRepl(createProgram);
    } else {
      showWelcomeScreen();
    }
  } else {
    const program = createProgram();
    await program.parseAsync(process.argv).catch(async (err) => {
      // The canonical command_executed failure event is emitted by the
      // postAction hook above; handleCommandError + the uncaughtException /
      // unhandledRejection handlers flush via flushTelemetryBeforeExit().
      // The catch here just ensures the buffer is drained on the parseAsync
      // boundary before propagating to handleCommandError.
      await flushTelemetryBeforeExit();
      await handleCommandError(err);
    });
  }
}

main();
