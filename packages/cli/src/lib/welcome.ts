// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { CredentialStore } from "@pax8/core";
import { runUpdateCheck } from "./update-check.js";

declare const __CLI_VERSION__: string;

/**
 * Determines whether the user has any credentials configured (env vars or
 * file). Demo mode short-circuits to "authenticated" since the CLI works
 * end-to-end against MockPax8Client without real creds.
 *
 * Designed to be fast (<50 ms): no network, just a file `stat` and env
 * var read. Falls back to `false` (unauthenticated layout) on any error.
 */
async function isAuthenticated(): Promise<boolean> {
  if (process.env.PAX8_DEMO === "1") return true;
  try {
    const store = new CredentialStore();
    return await store.hasCredentials();
  } catch {
    return false;
  }
}

export async function showWelcomeScreen(): Promise<void> {
  // #183: nudge the user when a newer pax8-cli has been published. The
  // check is fire-and-forget from our perspective — `update-notifier`
  // reads its configstore synchronously and spawns the registry refresh
  // in a detached child process, so this doesn't block the welcome
  // render. Honors PAX8_NO_UPDATE_CHECK / PAX8_DEMO / PAX8_QUIET / CI /
  // NO_UPDATE_NOTIFIER and only writes to stderr (so it can never
  // pollute the welcome stdout block read by smoke tests).
  try {
    runUpdateCheck();
  } catch {
    // The check is a courtesy; never let it break the welcome render.
  }

  const version = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";

  const W = 48;
  const rule = chalk.cyan("─".repeat(W));

  const pax8Art = [
    "    ██████╗  █████╗ ██╗  ██╗ █████╗ ",
    "    ██╔══██╗██╔══██╗╚██╗██╔╝██╔══██╗",
    "    ██████╔╝███████║ ╚███╔╝ ╚█████╔╝",
    "    ██╔═══╝ ██╔══██║ ██╔██╗ ██╔══██╗",
    "    ██║     ██║  ██║██╔╝ ██╗╚█████╔╝",
    "    ╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝ ╚════╝ ",
  ];

  const subtitle = "    C O M M A N D   L I N E";
  const tagline = "   Manage your cloud marketplace from the terminal";
  const versionLine = `   v${version} · Open Source · Pax8 Labs`;

  // Short value-prop blurb above the command list. Pre-wrapped to keep
  // each line under ~70 chars.
  const blurb = [
    "  Pax8 CLI turns the marketplace API into computed answers —",
    "  renewals, invoice audits, Pax8 cost analytics, and upsell",
    "  recommendations.",
  ];

  const authed = await isAuthenticated();

  // Column width is sized to the longest command across both branches
  // (`PAX8_DEMO=1 pax8 dash…` = 26 chars). +2 for trailing padding so the
  // descriptions line up cleanly under either layout.
  const COL = 28;
  const cmd = (name: string): string => chalk.cyan(name.padEnd(COL));

  const commandBlock = authed
    ? [
        `  ${chalk.dim("Common commands:")}`,
        `    ${cmd("dashboard")}${chalk.dim("Portfolio at a glance")}`,
        `    ${cmd("subscriptions renewals")}${chalk.dim("What's renewing in 30 days")}`,
        `    ${cmd("recommendations")}${chalk.dim("Upsell opportunities")}`,
        `    ${cmd("invoices audit")}${chalk.dim("Reconcile invoices vs subscriptions")}`,
        "",
        `    ${cmd("help")}${chalk.dim("All commands · doctor for setup checks")}`,
      ]
    : [
        // First-run options. Order matters: the ephemeral one-shot demo is
        // listed first because it's the safer entry-point — it doesn't pin
        // demo mode in config and so it can't silently override a later
        // `auth login`. `init --demo` stays available but is annotated as
        // persistent so first-run users understand what they're enabling.
        `  ${chalk.dim("Try it:")}`,
        `    ${cmd("PAX8_DEMO=1 pax8 dashboard")}${chalk.dim("Sample data, one-shot (no setup)")}`,
        `    ${cmd("auth login")}${chalk.dim("Connect your Pax8 partner account")}`,
        `    ${cmd("init --demo")}${chalk.dim("Pin demo mode (persistent — disable with `demo off`)")}`,
        "",
        `  ${chalk.dim("Stuck?")}`,
        `    ${cmd("doctor")}${chalk.dim("Check your setup")}`,
        `    ${cmd("help")}${chalk.dim("All commands")}`,
      ];

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
    ...blurb.map((l) => chalk.dim(l)),
    "",
    ...commandBlock,
    "",
  ];
  process.stdout.write(lines.join("\n"));
}
