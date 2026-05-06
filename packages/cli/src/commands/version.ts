// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";

declare const __CLI_VERSION__: string;

export const versionCommand = new Command("version")
  .description("Print version information")
  .addHelpText(
    "after",
    `
Examples:
  pax8 version`
  )
  .action(async () => {
    const version = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";
    const nodeVersion = process.versions.node;
    const platform = `${process.platform}-${process.arch}`;

    process.stdout.write(`pax8-cli ${version}\n`);
    process.stdout.write(`node     v${nodeVersion}\n`);
    process.stdout.write(`platform ${platform}\n`);
    process.stdout.write(`\nhttps://github.com/pax8labs/pax8-cli\n`);
  });
