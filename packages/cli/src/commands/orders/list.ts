// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatDate } from "../../lib/formatters.js";
import { enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

const columns: Column[] = [
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "companyName", header: "Company" },
  { key: "orderedBy", header: "Ordered By" },
  { key: "createdDate", header: "Date", format: (v) => formatDate(String(v)) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "lineItems", header: "Items", format: (v) => String(Array.isArray(v) ? v.length : 0) },
];

export const ordersListCommand = new Command("list")
  .description("List orders")
  .option("--company <id|name>", "Filter by company ID or name")
  // Honesty note (#250): the public Pax8 OpenAPI does NOT document a `status`
  // field on `Order` nor a `status` query parameter on `GET /orders`. The
  // values below are observed in real API responses (and mirrored by the demo
  // fixtures) but are NOT part of the published contract — they may change
  // without notice. The flag is kept so partner scripts that already use it
  // don't break; see docs/triage/api-version-audit/orders-status-enum.md.
  .option(
    "--status <status>",
    "Filter by status (observed: Completed, Processing, Failed, PendingManual; not in public OpenAPI)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
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
      const params: { page: number; size: number; companyId?: string; status?: string } = {
        page: apiPage,
        size: parseInt(allOpts.size, 10),
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

      const emptyReasons: string[] = [];
      const filterDesc: string[] = [];
      if (allOpts.company) filterDesc.push(`company "${allOpts.company}"`);
      if (allOpts.status) filterDesc.push(`status ${allOpts.status}`);
      if (filterDesc.length > 0) {
        emptyReasons.push(
          `No orders match the filters: ${filterDesc.join(", ")}.`,
        );
      } else {
        emptyReasons.push("This tenant hasn't placed any orders yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No orders found.",
          reasons: emptyReasons,
          suggestions: [
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
      await handleCommandError(error, spinner, "Failed to list orders");
    }
  });
