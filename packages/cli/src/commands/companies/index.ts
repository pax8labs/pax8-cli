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
 * user-facing surface (per #317). Pax8 is structurally moving away from the
 * COMPANY noun in API contracts (PAE-2054 governance, Client Archetype PRD,
 * portal's "New Client Creation Form" GA, v2 quotes API `clientId`); the CLI
 * adopts the canonical user-facing noun. JSON output fields (`companyId`,
 * `companyName`) and the `--company` flag on other commands stay aligned with
 * whatever the wire actually carries until the API renames.
 *
 * Implementation note: the file/symbol names still read `companies*` because
 * the underlying Command objects are shared with the sub-files; renaming the
 * file names is a separate refactor. The user-facing command graph exposes
 * only `pax8 clients *`.
 */
export function registerCompaniesCommands(program: Command): void {
  const clients = new Command("clients").description("Manage clients");

  clients.addCommand(companiesListCommand);
  clients.addCommand(companiesShowCommand);
  clients.addCommand(companiesMoreCommand);
  clients.addCommand(companiesCreateCommand);
  clients.addCommand(companiesUpdateCommand);

  program.addCommand(clients);
}
