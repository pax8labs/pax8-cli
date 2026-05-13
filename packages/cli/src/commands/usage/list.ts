// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import type { UsageSummary } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatDate } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";

export const usageListCommand = new Command("list")
  .description("List usage summaries")
  .option("--subscription <id>", "List usage for a specific subscription ID (fastest path)")
  .option("--company <id|name>", "List usage across every subscription owned by a company")
  .option("--month <YYYY-MM>", "Filter by usage month (e.g. 2026-04)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 usage list --subscription sub-redwood-acronis-007
  pax8 usage list --company "Redwood Manufacturing"
  pax8 usage list --company "Redwood Manufacturing" --month 2026-04
  pax8 usage list --subscription sub-redwood-acronis-007 --json

Notes:
  Usage summaries are exposed by the Pax8 API only under a specific
  subscription (\`/v1/subscriptions/{id}/usage-summaries\`). \`--company\`
  is a convenience: the CLI resolves the company to its subscriptions and
  iterates. Pass \`--subscription <id>\` to skip the lookup when you already
  know the ID.`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching usage summaries...");

    try {
      spinner.start();
      const apiPage = Math.max(parseInt(options.page, 10) - 1, 0);
      const apiSize = parseInt(options.size, 10);

      // Resolve the set of subscription IDs to query. Three modes:
      //   --subscription <id>   → query exactly that subscription
      //   --company <id|name>   → resolve → list subs → iterate
      //   (neither)             → list ALL subscriptions and iterate
      let subscriptionIds: string[];
      if (options.subscription) {
        subscriptionIds = [String(options.subscription)];
      } else {
        const companyId = options.company
          ? await resolveCompanyId(ctx, options.company)
          : undefined;
        const subs = await ctx.api.subscriptions.list({
          companyId,
          size: 1000,
        });
        subscriptionIds = subs.content.map((s) => s.id);
      }

      // Fan out across the resolved subscription IDs. The Pax8 spec doesn't
      // document a flat list endpoint, so iteration is the only way to get a
      // multi-subscription view.
      const all: UsageSummary[] = [];
      for (const subId of subscriptionIds) {
        const result = await ctx.api.usage.listSummaries(subId, {
          page: apiPage,
          size: apiSize,
        });
        all.push(...result.content);
      }
      spinner.stop();

      // The Pax8 API doesn't expose a month/date filter on usage-summaries,
      // so honor --month client-side via the date prefix.
      const month: string | undefined = options.month;
      const summaries = month
        ? all.filter((u) => u.date?.startsWith(month))
        : all;

      if (globalOpts.idsOnly) {
        for (const item of summaries) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns = [
        { key: "id", header: "ID", width: 12, format: (v: unknown) => String(v).slice(0, 8) },
        { key: "companyName", header: "Company", width: 22 },
        { key: "productName", header: "Product", width: 28 },
        { key: "date", header: "Date", width: 14, format: (v: unknown) => formatDate(String(v)) },
        { key: "quantity", header: "Qty", width: 10 },
        { key: "subtotal", header: "Subtotal", width: 14, format: (v: unknown) => formatCurrency(Number(v)) },
      ];

      const filtersApplied: Record<string, string> = {};
      if (options.subscription) filtersApplied.subscription = String(options.subscription);
      if (options.company) filtersApplied.company = `"${options.company}"`;
      if (options.month) filtersApplied.month = String(options.month);
      const emptyReasons: string[] = [];
      if (options.subscription) {
        emptyReasons.push(
          "The subscription may not be a metered/usage-based product.",
        );
      } else if (options.company) {
        emptyReasons.push(
          "This company has no metered/usage-based subscriptions, or the period predates any usage.",
        );
      } else {
        emptyReasons.push(
          "No metered subscriptions are reporting usage right now.",
        );
      }

      output(summaries, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No usage summaries found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons,
          suggestions: [
            {
              command: "pax8 subscriptions list --json",
              description: "find metered subscriptions to query",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && summaries.length > 0) {
        const total = summaries.reduce((s, u) => s + (u.subtotal ?? 0), 0);
        process.stderr.write(
          chalk.dim(`\n  ${summaries.length} usage summaries · ${formatCurrency(total)} total\n`)
        );
        const first = summaries[0] as Record<string, unknown>;
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${first.id} --lines`))}  ${chalk.dim("view per-resource breakdown")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list usage summaries");
    }
  });
