// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { CredentialStore } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";
import { getOutputFormat } from "../../lib/context.js";

interface AuthStatusJson {
  authenticated: boolean;
  mode: "demo" | "live";
  clientIdMasked?: string;
}

export const authStatusCommand = new Command("status")
  .description("Show current authentication status")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth status
  pax8 auth status --json`
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const format = getOutputFormat(allOpts);
    const isDemo = process.env.PAX8_DEMO === "1";

    if (isDemo) {
      if (format === "json") {
        const payload: AuthStatusJson = {
          authenticated: true,
          mode: "demo",
        };
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        return;
      }

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

    if (format === "json") {
      const payload: AuthStatusJson = {
        authenticated: !!creds,
        mode: "live",
      };
      if (creds) {
        payload.clientIdMasked =
          creds.clientId.length > 8
            ? creds.clientId.slice(0, 4) + "…" + creds.clientId.slice(-4)
            : "****";
      }
      process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
      return;
    }

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
