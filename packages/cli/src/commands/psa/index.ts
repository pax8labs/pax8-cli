// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { buildPsaProvider, describeConnectWiseCredentialHelp, getPsaMappingsPath, loadPsaMappings, resolvePsaProviderName } from "../../lib/psa.js";

export const psaCommand = new Command("psa")
  .description("Manage read-only PSA reconciliation setup")
  .addCommand(
    new Command("test")
      .description("Verify PSA credentials/connectivity")
      .option("--provider <provider>", "PSA provider", "connectwise")
      .action(async (options, command) => {
        const ctx = await buildContext(command.optsWithGlobals());
        const providerName = resolvePsaProviderName(options.provider) ?? "connectwise";
        const provider = buildPsaProvider(ctx, providerName, []);
        await provider.testConnection();
        process.stdout.write(`${chalk.green("✓")} ${providerName} PSA credentials look usable\n`);
      }),
  )
  .addCommand(
    new Command("map")
      .description("Show local PSA mapping file status")
      .action(async () => {
        const mappings = await loadPsaMappings();
        process.stdout.write(`Mapping file: ${getPsaMappingsPath()}\n`);
        process.stdout.write(`Mappings: ${mappings.mappings.length}\n`);
        if (mappings.mappings.length === 0) {
          process.stdout.write(`\nAdd mappings to classify invoice discrepancies. ConnectWise env vars:\n`);
          for (const name of describeConnectWiseCredentialHelp()) process.stdout.write(`  ${name}\n`);
        }
      }),
  );
