// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import type { PromptObject } from "prompts";
import {
  CredentialStore,
  ERROR_AUTH_MISSING,
  ERROR_INVALID_INPUT,
  TokenManager,
} from "@pax8/core";
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
      `Run ${replCmd("pax8 auth login")} interactively (prompts for the secret without exposing it to shell history)`,
      "Or set environment variables: PAX8_CLIENT_ID and PAX8_CLIENT_SECRET",
    ],
    "https://devx.pax8.com/",
    ERROR_AUTH_MISSING,
  );
}

// Pax8 client IDs and secrets are opaque tokens but live within a predictable
// character class. Sanity-check the shape locally so a typo or partial paste
// is caught before we round-trip to /token for a 401. The 8-128 length band
// covers every credential the marketplace has issued without false-negatives
// on the upper end.
const CRED_FORMAT_RE = /^[A-Za-z0-9_-]{8,128}$/;

function credentialFormatError(field: "client-id" | "client-secret"): CliError {
  return new CliError(
    `Invalid ${field} format`,
    [
      `${field} must be 8-128 characters of [A-Za-z0-9_-] only`,
      "Likely cause: typo, trailing whitespace, or partial paste",
    ],
    [
      "Re-copy the value from https://devx.pax8.com/ and try again",
      `Or run ${replCmd("pax8 auth login")} interactively to enter it without shell-history exposure`,
    ],
    "https://devx.pax8.com/",
    ERROR_INVALID_INPUT,
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
  # Interactive (recommended — prompts for the secret without echoing it
  # to shell history)
  pax8 auth login

  pax8 auth login --json

  # macOS / Linux — env vars keep the secret out of shell history
  PAX8_CLIENT_ID=abc123 PAX8_CLIENT_SECRET=s3cret pax8 auth login

  # PowerShell
  $env:PAX8_CLIENT_ID="abc123"; $env:PAX8_CLIENT_SECRET="s3cret"; pax8 auth login

Note: passing --client-secret as a flag is supported but discouraged — flag
values are recorded in shell history. Prefer the interactive prompt or the
PAX8_CLIENT_SECRET environment variable.`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const outputFormat = getOutputFormat(allOpts);
    const jsonMode = outputFormat === "json";
    const isDemo = process.env.PAX8_DEMO === "1";

    // Warn (don't reject) when --client-secret is passed as a flag: the value
    // lands in shell history and process listings. We still honor the flag —
    // breaking it would surprise CI users — but route a one-line nudge to
    // stderr so an interactive user sees the safer alternatives. Fires
    // regardless of demo/real mode so the habit gets surfaced everywhere.
    if (options.clientSecret !== undefined) {
      process.stderr.write(
        chalk.yellow(
          "Tip: --client-secret as a flag lands the value in shell history. " +
            "Prefer the interactive prompt or PAX8_CLIENT_SECRET env var.\n",
        ),
      );
    }

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

    // Local shape check before we round-trip to /token. Catches typos,
    // trailing whitespace, and partial pastes — common when the user
    // double-clicks-to-select a credential string from a web UI. Saves a
    // network call and gives a clearer error than a generic 401.
    if (!CRED_FORMAT_RE.test(clientId)) {
      throw credentialFormatError("client-id");
    }
    if (!CRED_FORMAT_RE.test(clientSecret)) {
      throw credentialFormatError("client-secret");
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
