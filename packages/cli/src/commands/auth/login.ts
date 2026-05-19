// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import type { PromptObject } from "prompts";
import { CredentialStore, ERROR_AUTH_MISSING, TokenManager } from "@pax8/core";
import { ask } from "../../lib/prompts.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";
import { getOutputFormat } from "../../lib/context.js";

function authMissingError(): CliError {
  return new CliError(
    "Missing credentials",
    ["Both --client-id and --client-secret are required"],
    [
      `Provide credentials via flags: ${replCmd("pax8 auth login")} --client-id <id> --client-secret <secret>`,
      "Or set environment variables: PAX8_CLIENT_ID and PAX8_CLIENT_SECRET",
    ],
    "https://devx.pax8.com/",
    ERROR_AUTH_MISSING,
  );
}

export const authLoginCommand = new Command("login")
  .description("Authenticate with Pax8 API credentials")
  .option("--client-id <id>", "Pax8 client ID")
  .option("--client-secret <secret>", "Pax8 client secret")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth login --client-id abc123 --client-secret s3cret
  pax8 auth login --json

  # macOS / Linux
  PAX8_CLIENT_ID=abc123 PAX8_CLIENT_SECRET=s3cret pax8 auth login

  # PowerShell
  $env:PAX8_CLIENT_ID="abc123"; $env:PAX8_CLIENT_SECRET="s3cret"; pax8 auth login`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const outputFormat = getOutputFormat(allOpts);
    const jsonMode = outputFormat === "json";
    const isDemo = process.env.PAX8_DEMO === "1";

    if (isDemo) {
      // #471: success banner must not pollute stdout — `pax8 auth login --json | jq`
      // previously got ANSI text and parsing failed. Human banner goes to stderr;
      // `--json` mode emits a structured envelope on stdout.
      if (jsonMode) {
        process.stdout.write(
          JSON.stringify(
            {
              status: "authenticated",
              mode: "demo",
              nextActions: [
                {
                  command: "pax8 dashboard --json",
                  description: "Run a portfolio summary against the demo data set",
                },
              ],
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      process.stderr.write(
        chalk.green("\n  ✓ Authenticated (demo mode)\n\n")
      );
      return;
    }

    let clientId: string | undefined =
      options.clientId ?? process.env.PAX8_CLIENT_ID;
    let clientSecret: string | undefined =
      options.clientSecret ?? process.env.PAX8_CLIENT_SECRET;

    // Interactive fallback: prompt only when stdin is a TTY and credentials
    // weren't supplied via flags or env vars. Non-TTY without credentials
    // errors cleanly instead of hanging on a prompt.
    if ((!clientId || !clientSecret) && process.stdin.isTTY) {
      const questions: PromptObject[] = [];
      if (!clientId) {
        questions.push({
          type: "text",
          name: "clientId",
          message: "Client ID:",
          validate: (value: string) =>
            value.trim().length > 0 || "Client ID is required",
        });
      }
      if (!clientSecret) {
        questions.push({
          type: "password",
          name: "clientSecret",
          message: "Client Secret:",
          validate: (value: string) =>
            value.length > 0 || "Client Secret is required",
        });
      }

      const answers = await ask(questions);

      clientId = clientId ?? (answers.clientId as string | undefined);
      clientSecret = clientSecret ?? (answers.clientSecret as string | undefined);
    }

    if (!clientId || !clientSecret) {
      throw authMissingError();
    }

    const spinner = createSpinner("Validating credentials...").start();

    try {
      // Attempt to fetch a token to validate credentials
      const tokenManager = new TokenManager({ clientId, clientSecret });
      await tokenManager.getToken();

      // Credentials are valid — save them
      const store = new CredentialStore();
      await store.saveCredentials(clientId, clientSecret);

      const masked =
        clientId.length > 8
          ? clientId.slice(0, 4) + "…" + clientId.slice(-4)
          : "****";

      // #471: spinner.succeed and the saved-credentials banner are both
      // status — they belong on stderr. spinner.succeed already writes to
      // stderr via ora; the saved-credentials banner did not. In `--json`
      // mode, stop the spinner cleanly (no "Authenticated" affordance,
      // which is human-facing) and emit a structured envelope on stdout.
      if (jsonMode) {
        spinner.stop();
        process.stdout.write(
          JSON.stringify(
            {
              status: "authenticated",
              mode: "real",
              clientIdMasked: masked,
              nextActions: [
                {
                  command: "pax8 auth status --json",
                  description: "Confirm credentials are persisted and live",
                },
                {
                  command: "pax8 doctor --json",
                  description: "Run diagnostics to verify end-to-end API reachability",
                },
              ],
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      spinner.succeed("Authenticated");
      process.stderr.write(
        chalk.green(`\n  ✓ Credentials saved for ${masked}\n\n`)
      );
    } catch (error) {
      await handleCommandError(error, spinner, "Authentication failed");
    }
  });
