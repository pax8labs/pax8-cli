// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { CredentialStore } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";

export const authStatusCommand = new Command("status")
  .description("Show current authentication status")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth status`
  )
  .action(async () => {
    const isDemo = process.env.PAX8_DEMO === "1";

    if (isDemo) {
      process.stdout.write("\n");
      process.stdout.write(
        chalk.green("  ✓ Authenticated (demo mode)\n")
      );
      process.stdout.write(chalk.dim("  Mode: Demo\n"));
      process.stdout.write(
        chalk.dim("  All commands return mock data\n")
      );
      process.stdout.write("\n");
      return;
    }

    const store = new CredentialStore();
    const creds = await store.getCredentials();

    process.stdout.write("\n");

    if (creds) {
      const masked =
        creds.clientId.length > 8
          ? creds.clientId.slice(0, 4) + "…" + creds.clientId.slice(-4)
          : "****";

      process.stdout.write(chalk.green("  ✓ Authenticated\n"));
      process.stdout.write(chalk.dim(`  Client ID: ${masked}\n`));
      process.stdout.write(
        chalk.dim("  Secret: ••••••••\n")
      );
    } else {
      process.stdout.write(chalk.red("  ✗ Not authenticated\n"));
      process.stdout.write(
        chalk.dim(
          `\n  Run: ${replCmd("pax8 auth login")} --client-id <id> --client-secret <secret>\n`
        )
      );
    }

    process.stdout.write("\n");
  });
