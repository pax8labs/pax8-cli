// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { CredentialStore } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";
import {
  getOutputFormat,
  resolveDemoModeWithSourceAsync,
  disableDemoHint,
  type DemoSource,
} from "../../lib/context.js";

// `auth status` reports whether credentials are present on disk — it does NOT
// hit the API. A user with rotated or revoked credentials would see
// `credentialsPresent: true` here until the next real call to `/token` fails.
// For an actual authentication check, run `pax8 doctor`, which mints a token
// against the Pax8 API. The field name is deliberately literal so the JSON
// shape can't mislead an agent or script consumer (#573).
//
// `demoSource` is populated only when `mode === "demo"`. It tells consumers
// (and the human view) *where* demo mode was configured so they can disable
// it without guessing — same root cause as the silent-no-op trap fixed in
// `auth login`.
interface AuthStatusJson {
  credentialsPresent: boolean;
  mode: "demo" | "live";
  demoSource?: DemoSource;
  clientIdMasked?: string;
}

export const authStatusCommand = new Command("status")
  .description("Check whether credentials are stored locally (does not validate against the API; run `pax8 doctor` for that)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 auth status
  pax8 auth status --json

Notes:
  This command only checks for credentials on disk. To verify they actually
  authenticate against the Pax8 API, run \`pax8 doctor\`.`
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const format = getOutputFormat(allOpts);
    const { isDemo, source: demoSource } = await resolveDemoModeWithSourceAsync();

    if (isDemo) {
      if (format === "json") {
        const payload: AuthStatusJson = {
          credentialsPresent: true,
          mode: "demo",
          demoSource,
        };
        process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(
        chalk.green("  ✓ Credentials present (demo mode)\n")
      );
      process.stdout.write(chalk.dim("  Mode: Demo\n"));
      process.stdout.write(
        chalk.dim("  All commands return mock data\n")
      );
      if (demoSource) {
        process.stdout.write(
          chalk.dim(
            `  Demo source: ${demoSource} — disable with: ${disableDemoHint(demoSource)}\n`,
          ),
        );
      }
      process.stdout.write("\n");
      return;
    }

    const store = new CredentialStore();
    const creds = await store.getCredentials();

    if (format === "json") {
      const payload: AuthStatusJson = {
        credentialsPresent: !!creds,
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

      process.stdout.write(chalk.green("  ✓ Credentials present\n"));
      process.stdout.write(chalk.dim(`  Client ID: ${masked}\n`));
      process.stdout.write(
        chalk.dim("  Secret: ••••••••\n")
      );
      process.stdout.write(
        chalk.dim(
          `\n  This only checks files on disk. Run ${replCmd("pax8 doctor")} to verify against the API.\n`
        )
      );
    } else {
      process.stdout.write(chalk.red("  ✗ No credentials stored\n"));
      process.stdout.write(
        chalk.dim(
          `\n  Run: ${replCmd("pax8 auth login")} --client-id <id> --client-secret <secret>\n`
        )
      );
    }

    process.stdout.write("\n");
  });
