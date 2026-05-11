// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatDate, formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import type { Quote } from "@pax8/core";

function quoteTotal(q: Quote): number {
  if (!q.lineItems) return 0;
  return q.lineItems.reduce((s, li) => s + (li.subtotal ?? (li.unitPrice ?? 0) * li.quantity), 0);
}

export const quotesListCommand = new Command("list")
  .description("List sales quotes")
  .option("--company <id|name>", "Filter by company ID or name")
  .option(
    "--status <status>",
    "Filter by status (draft, sent, accepted, declined, expired, ...)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes list
  pax8 quotes list --company "Summit Healthcare Partners"
  pax8 quotes list --status Sent
  pax8 quotes list --json
  pax8 quotes list --csv
  pax8 quotes list --ids-only | xargs -I{} pax8 quotes show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching quotes...");

    try {
      spinner.start();
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.quotes.list({
        companyId,
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });
      spinner.stop();

      // The Pax8 API doesn't expose a status filter on quotes list,
      // so honor --status client-side.
      const status: string | undefined = allOpts.status;
      const quotes = status
        ? result.content.filter((q) => q.status?.toLowerCase() === status.toLowerCase())
        : result.content;

      if (allOpts.idsOnly) {
        for (const item of quotes) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const enriched = quotes.map((q) => ({
        ...q,
        _total: quoteTotal(q),
        _items: q.lineItems?.length ?? 0,
      }));

      const columns: Column[] = [
        { key: "id", header: "ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "companyId", header: "Company ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "status", header: "Status", width: 12 },
        { key: "createdOn", header: "Created", width: 14, format: (v) => formatDate(String(v)) },
        { key: "expiresOn", header: "Expires", width: 14, format: (v) => v ? formatDate(String(v)) : "—" },
        { key: "_items", header: "Items", width: 7 },
        { key: "_total", header: "Total", width: 12, format: (v) => formatCurrency(Number(v)) },
      ];

      const emptyReasons: string[] = [];
      const filterDesc: string[] = [];
      if (allOpts.company) filterDesc.push(`company "${allOpts.company}"`);
      if (status) filterDesc.push(`status ${status}`);
      if (filterDesc.length > 0) {
        emptyReasons.push(
          `No quotes match the filters: ${filterDesc.join(", ")}.`,
        );
      } else {
        emptyReasons.push("This tenant has no quotes yet.");
      }

      output(enriched, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No quotes found.",
          reasons: emptyReasons,
          suggestions: [
            {
              command: replCmd("pax8 quotes create --company <id|name>"),
              description: "draft your first quote",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && enriched.length > 0) {
        const total = enriched.reduce((s, q) => s + q._total, 0);
        process.stderr.write(
          chalk.dim(`\n  ${enriched.length} quotes · ${formatCurrency(total)} total\n`)
        );
        const first = enriched[0];
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 quotes show ${first.id}`))}  ${chalk.dim("view quote details")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list quotes");
    }
  });
