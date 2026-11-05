// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import type { UsageSummary } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, singlePageEnvelope } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import { clampListSize, LIST_SIZE_CAP, warnSizeClamped } from "../../lib/validate.js";
import {
  buildCompanyNameMap,
  enrichCompanyNames,
  enrichProductNames,
} from "../../lib/enrich-subscriptions.js";

/**
 * Sum `field` per currency. Usage can span currencies across a portfolio, so
 * a single grand total would be meaningless; rows without a code count as USD
 * (matching `formatCurrency`'s default).
 */
export function totalsByCurrency<T extends { currencyCode?: string | null }>(
  rows: T[],
  field: (row: T) => number,
): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const code = row.currencyCode || "USD";
    totals.set(code, (totals.get(code) ?? 0) + field(row));
  }
  return [...totals].map(([code, amount]) => formatCurrency(amount, code)).join(" + ");
}

export const usageListCommand = new Command("list")
  .description("List usage summaries")
  .option("--subscription <id>", "List usage for a specific subscription ID (fastest path)")
  .option("--company <id|name>", "List usage across every subscription owned by a company")
  .option(
    "--month <YYYY-MM>",
    "Deprecated and ignored: summaries cover the current billing period only",
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 usage list --subscription sub-redwood-acronis-007
  pax8 usage list --company "Redwood Manufacturing"
  pax8 usage list --subscription sub-redwood-acronis-007 --json

Notes:
  Each summary is the current billing period's metered usage for one
  resource group of a subscription. For a single day's breakdown, use
  \`pax8 usage show <id> --lines --date YYYY-MM-DD\`.

  Usage summaries are exposed by the Pax8 API only under a specific
  subscription (\`/v1/subscriptions/{id}/usage-summaries\`). \`--company\`
  is a convenience: the CLI resolves the company to its subscriptions and
  iterates. Pass \`--subscription <id>\` to skip the lookup when you already
  know the ID.

  Pagination: the per-subscription endpoint accepts \`page\` / \`size\`. Use
  \`--page\` and \`--size\` (default 50, max ${LIST_SIZE_CAP} per page; values above the
  cap are clamped with a stderr warning, #518). When fanning out via
  \`--company\` or no filter, each subscription is fetched with the same
  page / size — results from all subscriptions are concatenated, so
  consumers should treat the combined output as a single result set and
  re-query with a larger \`--size\` if any one subscription truncates.`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching usage summaries...");

    try {
      spinner.start();
      const apiPage = Math.max(parseInt(options.page, 10) - 1, 0);
      // #518: clamp `--size` at LIST_SIZE_CAP (1000).
      const sizeResult = clampListSize(parseInt(options.size, 10), 50);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: globalOpts.quiet });
      }
      const apiSize = sizeResult.size;

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

      // The wire shape carries only IDs; resolve names for the table and
      // JSON. Best-effort — a lookup failure leaves the IDs in place.
      try {
        enrichCompanyNames(await buildCompanyNameMap(ctx, all, { quiet: globalOpts.quiet }), all);
        await enrichProductNames(ctx, all);
      } catch {
        // Names are a convenience; never fail the listing over them.
      }
      spinner.stop();

      // Summaries have no date (they're current-period rollups), so --month
      // can't filter anything. Kept as a no-op so existing scripts don't break.
      if (options.month && !globalOpts.quiet && process.env.PAX8_QUIET !== "1") {
        process.stderr.write(
          `\n  ⚠ --month is ignored: usage summaries cover the current billing period only. ` +
            `For one day, use \`pax8 usage show <id> --lines --date YYYY-MM-DD\`.\n`,
        );
      }
      const summaries = all;

      if (globalOpts.idsOnly) {
        for (const item of summaries) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // #483: wrap JSON as { usage, page }. The endpoint is per-subscription
      // (we fan out), so server pagination is per-call; we surface a
      // single-page envelope summarizing the aggregated result instead.
      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify(
            { usage: summaries, page: singlePageEnvelope(summaries.length) },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      const columns = [
        { key: "id", header: "ID", width: 12, format: (v: unknown) => String(v).slice(0, 8) },
        { key: "companyName", header: "Company", width: 22 },
        { key: "productName", header: "Product", width: 28 },
        { key: "resourceGroup", header: "Resource group", width: 18 },
        {
          key: "currentCharges",
          header: "Charges",
          width: 12,
          format: (v: unknown, row?: Record<string, unknown>) =>
            formatCurrency(Number(v), String(row?.currencyCode ?? "USD")),
        },
        {
          key: "partnerTotal",
          header: "Partner total",
          width: 15,
          format: (v: unknown, row?: Record<string, unknown>) =>
            formatCurrency(Number(v), String(row?.currencyCode ?? "USD")),
        },
      ];

      const filtersApplied: Record<string, string> = {};
      if (options.subscription) filtersApplied.subscription = String(options.subscription);
      if (options.company) filtersApplied.company = `"${options.company}"`;
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
        process.stderr.write(
          chalk.dim(
            `\n  ${summaries.length} usage summaries · ` +
              `${totalsByCurrency(summaries, (u) => u.currentCharges)} charges · ` +
              `${totalsByCurrency(summaries, (u) => u.partnerTotal)} partner total\n`,
          ),
        );
        const first = summaries[0] as Record<string, unknown>;
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 usage show ${first.id} --lines`))}  ${chalk.dim("view today's per-product breakdown")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list usage summaries");
    }
  });
