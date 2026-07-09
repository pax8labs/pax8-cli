// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";

declare const __CLI_VERSION__: string;
import { registerAuthCommands } from "./commands/auth/index.js";
import { registerConfigCommands } from "./commands/config/index.js";
import { registerDemoCommands } from "./commands/demo/index.js";
import { registerCompaniesCommands } from "./commands/companies/index.js";
import { registerSubscriptionsCommands } from "./commands/subscriptions/index.js";
import { registerProductsCommands } from "./commands/products/index.js";
import { registerInvoicesCommands } from "./commands/invoices/index.js";
import { registerOrdersCommands } from "./commands/orders/index.js";
import { registerRecommendationsCommands } from "./commands/recommendations/index.js";
import { registerTelemetryCommands } from "./commands/telemetry/index.js";
import { registerCacheCommands } from "./commands/cache/index.js";
import { registerUsageCommands } from "./commands/usage/index.js";
import { registerWebhooksCommands } from "./commands/webhooks/index.js";
import { registerContactsCommands } from "./commands/contacts/index.js";
import { registerQuotesCommands } from "./commands/quotes/index.js";
import { registerCostCommands } from "./commands/cost/index.js";
import { registerReportCommands } from "./commands/report/index.js";
import { dashboardCommand } from "./commands/dashboard.js";
import { todayCommand } from "./commands/today.js";
import { doctorCommand } from "./commands/doctor.js";
import { completionsCommand } from "./commands/completions.js";
import { versionCommand } from "./commands/version.js";
import { initCommand } from "./commands/init.js";
import { explainCommand } from "./commands/explain.js";
import { reportBugCommand } from "./commands/report-bug.js";
import { handleCommandError, flushTelemetryBeforeExit } from "./lib/errors.js";
import { installSigintHandler } from "./lib/signals.js";
import { consumeTelemetryFields, setActiveCommand, consumeActiveCommand } from "./lib/telemetry-context.js";
import { mooCommand } from "./commands/easter-eggs/moo.js";
import { coffeeCommand } from "./commands/easter-eggs/coffee.js";
import { getTimeQuip } from "./commands/easter-eggs/time-quip.js";
import {
  getTelemetry,
  getDefaultBaseUrl,
  getConfigDir,
  CredentialStore,
} from "@pax8/core";
import { resolveDemoModeAsync } from "./lib/context.js";
import type { Command as CommandType } from "commander";
import { startRepl } from "./lib/repl.js";
import { showWelcomeScreen } from "./lib/welcome.js";
import { runUpdateCheck } from "./lib/update-check.js";

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
  registerDemoCommands(program);
  registerCompaniesCommands(program);
  registerSubscriptionsCommands(program);
  registerProductsCommands(program);
  registerInvoicesCommands(program);
  registerOrdersCommands(program);
  registerRecommendationsCommands(program);
  registerTelemetryCommands(program);
  registerCacheCommands(program);
  registerUsageCommands(program);
  registerWebhooksCommands(program);
  registerContactsCommands(program);
  registerQuotesCommands(program);
  registerCostCommands(program);
  registerReportCommands(program);
  program.addCommand(dashboardCommand);
  program.addCommand(todayCommand);
  program.addCommand(initCommand);
  program.addCommand(doctorCommand);
  program.addCommand(explainCommand);
  program.addCommand(completionsCommand);
  program.addCommand(versionCommand);
  program.addCommand(reportBugCommand());

  // Easter egg commands (hidden from main help)
  program.addCommand(mooCommand, { hidden: true });
  program.addCommand(coffeeCommand, { hidden: true });

  // #598: make Commander's own parse errors (unknown command, missing
  // required argument, unknown option, invalid choice, --help, --version)
  // throw instead of short-circuiting via Commander's internal
  // `process.exit()`. Without this, the parseAsync.catch in main() never
  // sees them, the program-level preAction hook never runs, and the
  // failure-event telemetry wired up in #597 stays blind to the most
  // common typo / friction surfaces.
  //
  // We also redirect Commander's own stderr error writes to a no-op so
  // the user doesn't see "error: unknown command 'X'" from Commander
  // followed by our own envelope rendering the same thing. `handleCommandError`
  // is now the single owner of the user-visible error surface for these.
  // (--help / --version still write to stdout via Commander before
  // throwing — those are content the user asked for, not error output.)
  //
  // Critically, Commander 12 does NOT propagate `exitOverride` or
  // `configureOutput` from the root program to subcommands — each Command
  // has its own `_exitCallback` and `_outputConfiguration`. A missing
  // required argument on `pax8 subscriptions show` would otherwise still
  // call `process.exit()` from the subcommand directly, bypassing our
  // handler. So we walk the entire command tree and apply both. Verified
  // against Commander 12.1.0; cross-version assumption pinned by a
  // subcommand parse-error test in telemetry.test.ts.
  const applyExitOverride = (cmd: Command): void => {
    cmd.exitOverride();
    cmd.configureOutput({
      outputError: () => {
        /* suppressed — handleCommandError owns the user-facing render */
      },
    });
    for (const sub of cmd.commands) applyExitOverride(sub);
  };
  applyExitOverride(program);

  // ── Telemetry: record start time before every command ───────────────
  const commandStartTimes = new WeakMap<CommandType, number>();

  // Time-based quip hook and demo mode banner
  program.hook("preAction", async (_thisCommand, actionCommand) => {
    // Record start time for duration tracking
    const now = Date.now();
    commandStartTimes.set(actionCommand, now);

    // Stash the active command in telemetry-context so the failure path
    // (`handleCommandError`) can emit a `command_executed { success: false }`
    // event with the right command metadata. Without this, Commander's
    // postAction hook only fires for the success path and failures get
    // no telemetry attribution.
    const subcommand = getFullCommandName(actionCommand);
    setActiveCommand({
      command: subcommand.split(".")[0] ?? subcommand,
      subcommand,
      flags: extractCommandFlags(actionCommand),
      startTime: now,
    });

    const quip = getTimeQuip();
    if (quip) {
      process.stderr.write(quip + "\n");
    }

    // Show demo mode banner if active. Uses the centralized resolver so
    // PAX8_DEMO=false / =0 correctly suppresses the banner even when
    // `config.demo: true` is set (otherwise the banner stays on even
    // though the command is hitting the real API).
    if (await resolveDemoModeAsync()) {
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
    // Action completed without throwing → clear the active-command
    // sentinel so `handleCommandError` doesn't accidentally re-emit
    // the same command as a failure event later in the process
    // lifetime (notably in long-lived REPL parents).
    consumeActiveCommand();
    try {
      const telemetry = getTelemetry();
      // Always consume so a leftover from a (rare) early-returning handler
      // doesn't leak into a later command run in the same process (REPL).
      const handlerProps = consumeTelemetryFields();
      if (!telemetry.isEnabled()) return;

      const startTime = commandStartTimes.get(actionCommand) ?? Date.now();
      const subcommand = getFullCommandName(actionCommand);
      const flags = extractCommandFlags(actionCommand);
      const isDemo = await resolveDemoModeAsync();
      // #621: emit credential-store state independently of demo_mode so we
      // can answer "what share of partners transition from demo to real
      // auth" and similar onboarding-funnel questions. Same primitive
      // welcome.ts and `auth status` use; sub-millisecond stat + env-var
      // read. Computed AFTER the action ran so a successful `auth login`
      // emits `credentialed: true`.
      let credentialed = false;
      try {
        credentialed = await new CredentialStore().hasCredentials();
      } catch {
        // Telemetry must never crash the CLI. hasCredentials() already
        // swallows fs errors, but defense-in-depth in case PAX8_CONFIG_DIR
        // validation throws synchronously.
      }

      // Attribute credentialed runs to a partner-account group so PostHog
      // reports real account-level unique counts (not one "user" per
      // ephemeral install). Only a salted hash of the clientId leaves the
      // machine; the per-install distinct_id is untouched. Gated on
      // `credentialed` so uncredentialed/demo runs pay no extra read and
      // stay attributed to the anonymous id only.
      if (credentialed) {
        try {
          const creds = await new CredentialStore().getCredentials();
          telemetry.setAccount(creds?.clientId ?? null);
        } catch {
          telemetry.setAccount(null);
        }
      }

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
        credentialed,
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

  // #234 / #262: validate trust-sensitive env vars at startup, BEFORE any
  // command dispatch or broad catches further in. If PAX8_API_BASE points
  // at an attacker-controlled http:// host or PAX8_CONFIG_DIR resolves
  // outside $HOME, we want the user to see the security error and exit
  // non-zero — not have it swallowed by the preAction hook's
  // best-effort `loadConfig()` catch. Force the lazy validators to run
  // here; their errors land on the global handler and get the standard
  // recovery-step rendering.
  try {
    getDefaultBaseUrl();
    getConfigDir();
  } catch (err) {
    await flushTelemetryBeforeExit();
    await handleCommandError(err);
  }

  if (process.argv.length <= 2) {
    // PAX8_REPL_FORCE is an internal test seam: the REPL integration test
    // (repl.integration.test.ts) needs to drive the prompt over a stdin pipe,
    // which means stdin is not a TTY. Without this override there is no way
    // to exercise REPL child-spawn from a subprocess test, and the
    // MODULE_NOT_FOUND class of bug (#226 / #227) would ship invisibly again.
    if (process.stdin.isTTY || process.env.PAX8_REPL_FORCE === "1") {
      await startRepl(createProgram);
    } else {
      await showWelcomeScreen();
    }
  } else {
    // #183: nudge once per release when a newer pax8-cli is available.
    // Fires before parse so the registry refresh (detached child process
    // inside `update-notifier`) has the full command duration to settle
    // and the synchronous cache read happens before any --json output
    // could open the stdout pipe. The wrapper handles all suppression
    // signals (PAX8_NO_UPDATE_CHECK, PAX8_DEMO, --json, --quiet, CI,
    // NO_UPDATE_NOTIFIER) and renders only to stderr.
    try {
      runUpdateCheck();
    } catch {
      // Never let the courtesy nudge break command dispatch.
    }
    const program = createProgram();
    await program.parseAsync(process.argv).catch(async (err) => {
      // `handleCommandError` itself emits the `command_executed`
      // failure event (using the active command stashed by preAction
      // in telemetry-context) and flushes before exit.
      await handleCommandError(err);
    });
  }
}

main();
