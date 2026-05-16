// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ALL_SUBS_PAGE_SIZE, getUpcomingRenewals } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatDaysUntil,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

function parseWithinDays(within: string): number {
  const match = within.match(/^(\d+)d$/);
  if (!match) {
    throw new Error(
      `Invalid --within value: "${within}". Use format like 7d, 14d, 30d, 90d.`
    );
  }
  return parseInt(match[1], 10);
}

const columns: Column[] = [
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty", format: (v) => String(v) },
  {
    key: "renewalDate",
    header: "Renews",
    format: (v) => formatDaysUntil(v as Date),
  },
  { key: "billingTerm", header: "Term" },
];

export const subscriptionsRenewalsCommand = new Command("renewals")
  .description("Show upcoming subscription renewals")
  .option("--within <period>", "Time window (e.g. 7d, 14d, 30d, 90d)", "30d")
  .option("--company <id|name>", "Filter by company")
  .option("--with-actions", "Wrap JSON output as { renewals, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions renewals
  pax8 subscriptions renewals --within 7d
  pax8 subscriptions renewals --company "Summit Healthcare"
  pax8 subscriptions renewals --json

What this measures:
  This command surfaces renewal exposure (subscriptions whose commitment
  ends within the requested window), not churn risk prediction. Pax8's
  Revenue at Risk Predictor is a separate ML-based product that scores
  the probability of churn — this CLI metric is a temporal filter, not
  a predictive score.

  In v0.x output the field is named \`mrrRenewing\` (and \`arrRenewing\`).
  These names are preserved on the wire so existing partner-side
  risk-framing scripts keep working. The previous \`mrrAtRisk\` /
  \`arrAtRisk\` keys are emitted alongside as deprecated aliases and will
  be removed in a future minor version.

Metric definitions:
  Pax8 monthly cost (a.k.a. mrrRenewing on the wire): The partner's
  monthly cost to Pax8 from active subscriptions. For monthly billing
  terms: price × quantity. For annual billing terms: (price × quantity)
  ÷ 12. Excludes one-time charges and prorated amounts. This is what
  the partner pays Pax8, not the partner's resale revenue — internal
  Pax8 reporting may also refer to it as "Partner Gross MRR" in the
  Unified Semantic Layer.

  Pax8 annual cost (a.k.a. arrRenewing on the wire): Pax8 monthly cost
  × 12. The yearly equivalent.

JSON output (--json):
  Default: a flat array of Renewal objects. With --with-actions,
  wrapped as { renewals, nextActions }.

  Renewal = {
    "subscriptionId": string,
    "companyId": string,
    "companyName": string,
    "productName": string,
    "quantity": number,
    "renewalDate": string,                // YYYY-MM-DD
    "billingTerm": string,
    "price": number,
    "mrrRenewing": number,                // canonical key (#298)
    "mrrAtRisk": number,                  // DEPRECATED alias of mrrRenewing — removed in a future minor
    "arrRenewing": number,                // canonical key (#298)
    "arrAtRisk": number,                  // DEPRECATED alias of arrRenewing — removed in a future minor
    "daysUntilRenewal": number
  }

  The mrrAtRisk / arrAtRisk aliases are dual-emitted alongside the canonical
  mrrRenewing / arrRenewing fields for one minor version cycle so existing
  scripts don't break. Migrate to the renewing-named fields; the at-risk
  names will be removed in a future minor version (see #299).

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const withinDays = parseWithinDays(options.within);

      // Fetch subscriptions and companies in parallel
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;
      const [result, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, companyId }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Enrich with product and company names
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }
      enrichCompanyNames(companyNames, result.content);
      await enrichProductNames(ctx, result.content as Record<string, unknown>[]);
      const allSubs = result.content;

      spinner.stop();

      const report = getUpcomingRenewals(allSubs, withinDays);

      if (ctx.outputFormat === "json") {
        const renewalItems = report.items.map((item) => {
          const mrr = Number(item.mrrRenewing.toFixed(2));
          const arr = Number(item.arrRenewing.toFixed(2));
          return {
            ...item,
            mrrRenewing: mrr,
            arrRenewing: arr,
            // Deprecated aliases — emitted alongside the canonical names for
            // one minor version cycle so existing scripts don't break. See #298.
            mrrAtRisk: mrr,
            arrAtRisk: arr,
            renewalDate: item.renewalDate.toISOString().split("T")[0],
          };
        });
        if (options.withActions) {
          const nextActions = report.items
            .slice(0, 5)
            .map((item) => ({
              command: `pax8 subscriptions show ${item.subscriptionId}`,
              description: `View renewal details for ${item.companyName} — ${item.productName} (${item.daysUntilRenewal}d)`,
            }));
          process.stdout.write(JSON.stringify({ renewals: renewalItems, nextActions }, null, 2) + "\n");
        } else {
          process.stdout.write(JSON.stringify(renewalItems, null, 2) + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(
          report.items.map((item) => ({
            ...item,
            renewalDate: item.renewalDate.toISOString().split("T")[0],
          })),
          { format: "csv", columns }
        );
        return;
      }

      if (report.items.length === 0) {
        process.stdout.write(
          chalk.green(`\n  🎉 No subscriptions renewing within ${withinDays} days. Smooth sailing!\n`)
        );
        if (report.skippedNoDate > 0) {
          process.stdout.write(
            chalk.dim(`  ℹ ${report.skippedNoDate} subscription${report.skippedNoDate !== 1 ? "s have" : " has"} no renewal date set — these may be month-to-month.\n`)
          );
        }
        process.stdout.write("\n");
        return;
      }

      output(report.items, { format: "table", columns });

      // Header keeps the Pax8 monthly cost figure primary (Pax8's canonical
      // operational unit per the Unified Semantic Layer / Voyager Alliance /
      // dwh fact tables, wire-side field name `mrrRenewing`), with the
      // annualized figure as a parallel companion. The per-row table stays
      // monthly-only to avoid clutter; the annualized total lives in the
      // JSON for consumers who want it. See #295 — PFR-86 escalations frame
      // risk in annualized terms, so QBR / strategic conversations get the
      // right unit too. Wording renamed in #298 from "at risk" → "renewing"
      // to disambiguate from Pax8's patent-filed Revenue at Risk Predictor
      // (an ML churn-likelihood model).
      process.stdout.write(
        chalk.dim(
          `\n  ${report.items.length} renewals within ${withinDays} days — ${formatCurrency(report.totalMrrRenewing)}/mo · ${formatCurrency(report.totalArrRenewing)}/yr Pax8 cost renewing in window\n`
        )
      );

      // Urgent annual warning
      const urgentAnnual = report.items.filter(
        (i) =>
          i.daysUntilRenewal <= 14 &&
          (i.billingTerm.toLowerCase().includes("annual") ||
            i.billingTerm.toLowerCase().includes("yearly"))
      );

      if (urgentAnnual.length > 0) {
        process.stdout.write(
          chalk.yellow(
            `\n  ⚠ ${urgentAnnual.length} annual subscription${urgentAnnual.length !== 1 ? "s" : ""} renewing within 14 days\n`
          )
        );
        process.stdout.write(chalk.dim("    Before lock-in, you can:\n"));
        process.stdout.write(chalk.dim("    • Reduce seats to match actual usage\n"));
        process.stdout.write(chalk.dim("    • Switch billing term (monthly ↔ annual)\n"));
        process.stdout.write(chalk.dim("    • Cancel if the customer is churning\n"));
      }

      // Show actionable commands for the most urgent item — numbered so
      // partners and agents can drill in interactively via `promptNextSteps`.
      // The `subscriptions update ... --quantity <n>` option carries a
      // placeholder so we leave it off the pickable list (drilling into it
      // would just hit a quantity-required error); it remains as advisory
      // text in the renewals output above. See #379-area UX feedback.
      if (ctx.outputFormat === "table" && report.items.length > 0) {
        const top = report.items[0];
        const steps: NextStep[] = [
          {
            key: "1",
            label: `${chalk.cyan(`subscriptions show ${top.subscriptionId}`)}  ${chalk.dim("view details")}`,
            command: ["subscriptions", "show", top.subscriptionId],
          },
          {
            key: "2",
            label: `${chalk.cyan(`clients more "${top.companyName}"`)}  ${chalk.dim("view client")}`,
            command: ["clients", "more", top.companyName],
          },
        ];
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
        // Static advisory below the pickable list — the `--quantity <n>`
        // command can't be picked interactively (needs a value), but the
        // suggestion is still worth surfacing.
        process.stderr.write(
          `  ${chalk.dim("Or:")} ${chalk.cyan(`pax8 subscriptions update ${top.subscriptionId} --quantity <n>`)} ${chalk.dim("to adjust seats")}\n`,
        );
      }

      process.stdout.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to fetch renewals");
    }
  });
