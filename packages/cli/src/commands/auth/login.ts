import { Command } from "commander";
import chalk from "chalk";
import { CredentialStore, TokenManager } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";

export const authLoginCommand = new Command("login")
  .description("Authenticate with Pax8 API credentials")
  .option("--client-id <id>", "Pax8 client ID")
  .option("--client-secret <secret>", "Pax8 client secret")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth login --client-id abc123 --client-secret s3cret

  # macOS / Linux
  PAX8_CLIENT_ID=abc123 PAX8_CLIENT_SECRET=s3cret pax8 auth login

  # PowerShell
  $env:PAX8_CLIENT_ID="abc123"; $env:PAX8_CLIENT_SECRET="s3cret"; pax8 auth login`
  )
  .action(async (options) => {
    const isDemo = process.env.PAX8_DEMO === "1";

    if (isDemo) {
      process.stdout.write(
        chalk.green("\n  ✓ Authenticated (demo mode)\n\n")
      );
      return;
    }

    const clientId: string | undefined =
      options.clientId ?? process.env.PAX8_CLIENT_ID;
    const clientSecret: string | undefined =
      options.clientSecret ?? process.env.PAX8_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new CliError(
        "Missing credentials",
        ["Both --client-id and --client-secret are required"],
        [
          "Provide credentials via flags: pax8 auth login --client-id <id> --client-secret <secret>",
          "Or set environment variables: PAX8_CLIENT_ID and PAX8_CLIENT_SECRET",
        ],
        "https://devx.pax8.com/"
      );
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

      spinner.succeed("Authenticated");
      process.stdout.write(
        chalk.green(`\n  ✓ Credentials saved for ${masked}\n\n`)
      );
    } catch (error) {
      handleCommandError(error, spinner, "Authentication failed");
    }
  });
