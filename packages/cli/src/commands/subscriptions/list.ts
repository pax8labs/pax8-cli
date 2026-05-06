// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatStatus,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

const columns: Column[] = [
  {
    key: "id",
    header: "ID",
    format: (v) => chalk.dim(String(v).slice(0, 8)),
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty", format: (v) => String(v) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "billingTerm", header: "Term" },
  {
    key: "price",
    header: "Price",
    format: (v) => formatCurrency(Number(v)),
  },
];

export const subscriptionsListCommand = new Command("list")
  .description("List subscriptions")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--status <status>", "Filter by status (Active, Cancelled, PendingManual, Trial, etc.)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option("--with-actions", "Wrap JSON output as { subscriptions, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions list
  pax8 subscriptions list --company "Summit Healthcare Partners"
  pax8 subscriptions list --status Active
  pax8 subscriptions list --size 10 --page 2
  pax8 subscriptions list --json
  pax8 subscriptions list --json --with-actions
  pax8 subscriptions list --csv
  pax8 subscriptions list --ids-only | xargs -I{} pax8 subscriptions show {}`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.subscriptions.list({
        companyId,
        status: allOpts.status,
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });

      const subs = result.content as Record<string, unknown>[];
      // Enrich product and company names in parallel
      const companiesPromise = ctx.api.companies.list({ size: 200 });
      await enrichProductNames(ctx, subs);
      try {
        const companies = await companiesPromise;
        const nameMap = new Map((companies.content as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
        enrichCompanyNames(nameMap, subs);
      } catch { /* best effort */ }

      spinner.stop();

      if (options.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json" && options.withActions) {
        const nextActions: { command: string; description: string }[] = [];
        const subsList = result.content;
        const trials = subsList.filter((s) => (s.status ?? "").toLowerCase() === "trial");
        const top = subsList[0];
        if (top) {
          nextActions.push({
            command: `pax8 subscriptions show ${top.id}`,
            description: `View details for the first subscription (${(top as Record<string, unknown>).productName ?? "subscription"})`,
          });
        }
        if (trials.length > 0) {
          nextActions.push({
            command: "pax8 subscriptions list --status Trial --json",
            description: `Review ${trials.length} trial subscription${trials.length > 1 ? "s" : ""} to convert or cancel`,
          });
        }
        nextActions.push({
          command: "pax8 subscriptions renewals --json --with-actions",
          description: "Check upcoming renewals before they auto-renew",
        });
        process.stdout.write(
          JSON.stringify({ subscriptions: result.content, nextActions }, null, 2) + "\n"
        );
        return;
      }

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} subscriptions\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list subscriptions");
    }
  });
