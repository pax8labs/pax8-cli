// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";

declare const __CLI_VERSION__: string;

export function showWelcomeScreen(): void {
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
