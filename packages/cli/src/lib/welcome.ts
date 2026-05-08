// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import { CredentialStore } from "@pax8/core";

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
    "  renewals, invoice audits, MRR, and upsell recommendations.",
  ];

  const authed = await isAuthenticated();

  // Column width is sized to the longest command across both branches
  // (`subscriptions renewals` = 22 chars). +2 for trailing padding so the
  // descriptions line up cleanly under either layout.
  const COL = 24;
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
        `  ${chalk.dim("Try it:")}`,
        `    ${cmd("init --demo")}${chalk.dim("Sample data, no auth required")}`,
        `    ${cmd("auth login")}${chalk.dim("Connect your Pax8 partner account")}`,
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
