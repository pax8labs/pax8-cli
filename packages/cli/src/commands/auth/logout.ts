// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { CredentialStore } from "@pax8/core";
import { confirm } from "../../lib/confirm.js";

export const authLogoutCommand = new Command("logout")
  .description("Clear stored credentials")
  .option("--yes, -y", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth logout
  pax8 auth logout --yes`
  )
  .action(async (options) => {
    const isDemo = process.env.PAX8_DEMO === "1";

    if (isDemo) {
      process.stdout.write(
        chalk.green("\n  ✓ Logged out (demo mode)\n\n")
      );
      return;
    }

    if (!options.yes) {
      const confirmed = await confirm(
        "Clear all stored credentials?",
        { default: false }
      );
      if (!confirmed) {
        process.stdout.write(chalk.dim("\n  Cancelled\n\n"));
        return;
      }
    }

    const store = new CredentialStore();
    await store.clearCredentials();

    process.stdout.write(
      chalk.green("\n  ✓ Credentials cleared\n\n")
    );
  });
