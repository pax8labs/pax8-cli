// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ApiError, isApiTimeoutError, ERROR_API_TIMEOUT } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError, timeoutRecoverySteps } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { output, type Column } from "../../lib/output.js";
import { formatDate } from "../../lib/formatters.js";
import { enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { clampListSize, LIST_SIZE_CAP, warnSizeClamped } from "../../lib/validate.js";

// #385: timestamp column references the canonical `createdAt`. The legacy
// `createdDate` alias is still emitted on every row in `--json` output for
// backwards compatibility; removal in v0.3.0.
const columns: Column[] = [
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "companyName", header: "Company" },
  { key: "orderedBy", header: "Ordered By" },
  { key: "createdAt", header: "Date", format: (v) => formatDate(String(v)) },
  { key: "lineItems", header: "Items", format: (v) => String(Array.isArray(v) ? v.length : 0) },
];

export const ordersListCommand = new Command("list")
  .description("List orders")
  .option("--company <id|name>", "Filter by company ID or name")
  // Verified 2026-05-11 against the real API (docs/triage/orders-status-server-behavior.md):
  // the public Pax8 OpenAPI does NOT document a `status` field on `Order` or
  // a `status` query parameter on `GET /orders`, AND the server silently
  // ignores `?status=` — every value (including bogus ones like `NotAStatus`)
  // returns the full unfiltered set. The flag is kept so partner scripts that
  // already depend on it don't break, but it is a no-op until the Pax8 Orders
  // team surfaces a real status field (tracked in #369). The default table
  // output previously rendered a `Status` column that always showed `—` for
  // prod data; it has been dropped here. JSON output continues to include
  // `status` when the demo client emits it, for backwards compatibility.
  .option(
    "--status <status>",
    "No-op: server ignores filter; field not in public OpenAPI (see #369)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders list
  pax8 orders list --company "Summit Healthcare Partners"
  pax8 orders list --status Completed
  pax8 orders list --page 2 --size 25
  pax8 orders list --json
  pax8 orders list --csv
  pax8 orders list --ids-only | xargs -I{} pax8 orders show {}`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching orders...").start();

    try {
      const ctx = await buildContext(allOpts);
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      // #518: cap `--size` at LIST_SIZE_CAP (1000). The orders endpoint
      // returns ~34 MB of JSON for size=50000 — a context-window-killer
      // for agents and an OOM risk for CI runners. Clamp and warn on
      // stderr so the user can switch to `--page N --size 1000` paging.
      const sizeResult = clampListSize(parseInt(allOpts.size, 10), 25);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: allOpts.quiet });
      }
      const params: { page: number; size: number; companyId?: string; status?: string } = {
        page: apiPage,
        size: sizeResult.size,
      };
      if (allOpts.company) {
        params.companyId = await resolveCompanyId(ctx, allOpts.company);
      }
      if (allOpts.status) {
        params.status = allOpts.status;
      }

      const [result, companiesResult] = await Promise.all([
        ctx.api.orders.list(params),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Enrich company names
      const nameMap = new Map((companiesResult.content as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
      enrichCompanyNames(nameMap, result.content as Record<string, unknown>[]);

      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const filtersApplied: Record<string, string> = {};
      if (allOpts.company) filtersApplied.company = `"${allOpts.company}"`;
      if (allOpts.status) filtersApplied.status = String(allOpts.status);
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("This tenant hasn't placed any orders yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No orders found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 orders list",
              description: "list all orders (no filters)",
            },
            {
              command: "pax8 orders create --company <id> --product <id> --quantity <n>",
              description: "place a new order",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} orders\n\n`)
        );
      }
    } catch (error) {
      // #199: the `/orders` endpoint is known to be slow against tenants with
      // large historical order counts. When the 30s default fires, the generic
      // "Request timed out" message tells the partner nothing useful — surface
      // the concrete knobs they can turn (smaller page size, per-company
      // filter, env-var-driven timeout extension) instead of just the
      // millisecond count.
      if (isApiTimeoutError(error)) {
        const ordersSpecific = [
          "The /orders endpoint can be slow on large portfolios. Try a smaller page size:",
          `    ${chalk.cyan("pax8 orders list --size 10")}`,
          "Or narrow the scope to one customer:",
          `    ${chalk.cyan('pax8 orders list --company "<name>"')}`,
        ];
        // `isApiTimeoutError` guarantees the throw is an `ApiError`; cast
        // through it for the `.message` access. We avoid making the
        // predicate a TypeScript `error is ApiError` form because it would
        // narrow other callers (e.g. `codeForApiError(error: ApiError)`) to
        // `never` in their else-branches.
        const message = (error as ApiError).message;
        await handleCommandError(
          new CliError(
            message,
            undefined,
            timeoutRecoverySteps(ordersSpecific),
            undefined,
            ERROR_API_TIMEOUT,
          ),
          spinner,
          "Failed to list orders",
        );
      }
      await handleCommandError(error, spinner, "Failed to list orders");
    }
  });
