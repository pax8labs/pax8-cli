// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { companiesListCommand } from "./list.js";
import { companiesShowCommand } from "./show.js";
import { companiesCreateCommand } from "./create.js";
import { companiesUpdateCommand } from "./update.js";
import { companiesMoreCommand } from "./more.js";

/**
 * Register the clients command group. `pax8 clients *` is the canonical
 * user-facing surface; `pax8 companies *` is an indefinite deprecated
 * alias registered via Commander's native `.alias()` mechanism so both
 * invocations route through the exact same Command graph and action
 * handlers — by construction, the surfaces cannot drift.
 *
 * Why "indefinite" rather than aggressive deprecation: Pax8 is structurally
 * moving away from the COMPANY noun in API contracts (PAE-2054 governance,
 * Client Archetype PRD, portal's "New Client Creation Form" GA, v2 quotes
 * API `clientId`), but the public partner API hasn't shipped `/clients`
 * endpoints yet. The CLI command surface adopts the canonical user-facing
 * noun now; the data surface (JSON fields like `companyId`, `companyName`,
 * `--company` flag on other commands) stays aligned with whatever the wire
 * actually carries until the API renames. See #317.
 */
export function registerCompaniesCommands(program: Command): void {
  const clients = new Command("clients")
    .alias("companies")
    .description("Manage clients (alias: companies, deprecated)")
    .addHelpText(
      "after",
      `
Note: \`pax8 companies\` is a deprecated alias for \`pax8 clients\`. Both work
identically — the alias maps to the same Commander command graph, so there's
no behavior drift. Pax8 is standardizing on "client" as the canonical
user-facing noun (PAE-2054, Client Archetype PRD); the CLI tracks the
human-facing term. JSON output fields and \`--company\` flags on other
commands continue to mirror the public API and will migrate when the API
ships \`/clients\` endpoints.`,
    );

  clients.addCommand(companiesListCommand);
  clients.addCommand(companiesShowCommand);
  clients.addCommand(companiesMoreCommand);
  clients.addCommand(companiesCreateCommand);
  clients.addCommand(companiesUpdateCommand);

  program.addCommand(clients);
}
