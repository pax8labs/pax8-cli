// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import {
  ALL_SUBS_PAGE_SIZE,
  ERROR_INVALID_INPUT,
  getUpcomingRenewals,
  type AmountCurrency,
  type Product,
  type Subscription,
} from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import {
  formatCompanyName,
  formatCurrency,
  formatDaysUntil,
} from "../../lib/formatters.js";
import { enrichCompanyNames, enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

interface RenewalsOptions {
  within?: string;
  company?: string;
  vendor?: string;
  product?: string;
  sort?: string;
}

interface RenewalRow {
  subscriptionId: string;
  companyId: string;
  companyName: string;
  productName: string;
  vendorName: string;
  quantity: number;
  monthlyCost: AmountCurrency;
  commitmentTermEndDate: string;
  daysUntilEnd: number;
}

function parseWithin(raw: string | undefined): number {
  // Accept either "90" or "90d" (the existing subscriptions renewals command
  // uses "90d" notation). The spec for this command says "any positive int" —
  // matches what partners type — but we tolerate the legacy suffix too so
  // copy/paste from other commands doesn't blow up.
  if (raw === undefined || raw === "") return 90;
  const match = String(raw).match(/^(\d+)d?$/);
  if (!match) {
    throw new CliError(
      `Invalid --within value: "${raw}". Use a positive integer (number of days).`,
      undefined,
      ["Try a value like --within 30, --within 90, or --within 180."],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const n = parseInt(match[1], 10);
  if (n <= 0) {
    throw new CliError(
      `--within must be a positive integer, got ${n}.`,
      undefined,
      ["Try --within 30, --within 90, or --within 180."],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return n;
}

const tableColumns: Column[] = [
  {
    key: "subscriptionId",
    header: "Sub",
    format: (v) => String(v).slice(0, 8),
  },
  {
    key: "companyName",
    header: "Customer",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty", format: (v) => String(v) },
  {
    key: "monthlyCost",
    header: "Pax8 monthly cost",
    format: (v) => {
      const ac = v as AmountCurrency;
      return formatCurrency(ac.amount);
    },
  },
  {
    key: "commitmentTermEndDate",
    header: "Commitment ends",
    format: (v, row) => {
      const date = String(v);
      const days = (row as { daysUntilEnd?: number })?.daysUntilEnd ?? 0;
      return `${date} (${formatDaysUntil(date)}; ${days}d)`;
    },
  },
];

export const reportRenewalsCommand = new Command("renewals")
  .description(
    "Subscriptions with upcoming commitment-term-end dates and the Pax8 cost exposure they represent.",
  )
  .option("--within <days>", "Time window in days (e.g. 30, 60, 90, 180, 365)", "90")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--vendor <name>", "Filter by vendor (e.g. Microsoft, AvePoint)")
  .option("--product <name>", "Filter by product name (substring match)")
  .option("--sort <by-date|by-cost>", "Sort key — soonest renewal first, or largest Pax8 cost first", "by-date")
  .addHelpText(
    "after",
    `
Examples:
  pax8 report renewals
  pax8 report renewals --within 30
  pax8 report renewals --within 180 --sort by-cost
  pax8 report renewals --vendor Microsoft --json
  pax8 report renewals --company "Summit Healthcare Partners"

JSON output (--json):
  {
    "windowDays": number,
    "renewals": [{
      "subscriptionId": string,
      "companyId": string,
      "companyName": string,
      "productName": string,
      "vendorName": string,
      "quantity": number,
      "monthlyCost": { "amount": number, "currency": string },
      "commitmentTermEndDate": string,             // YYYY-MM-DD
      "daysUntilEnd": number
    }],
    "totalCount": number,
    "totalMonthlyCostExposure": { "amount": number, "currency": string }
  }

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`,
  )
  .action(async (options: RenewalsOptions, cmd: Command) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const withinDays = parseWithin(options.within);

      const sort = (options.sort ?? "by-date").toLowerCase();
      if (sort !== "by-date" && sort !== "by-cost") {
        throw new CliError(
          `Invalid --sort value: "${options.sort}".`,
          undefined,
          ["Use --sort by-date (default) or --sort by-cost."],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;

      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, companyId }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) companyNames.set(c.id, c.name);
      enrichCompanyNames(companyNames, subsResult.content);
      await enrichProductNames(ctx, subsResult.content as Record<string, unknown>[]);

      // Build a productId -> vendorName map so we can attach vendor info to
      // each renewal row. We fetch the full product catalog (size 500) once;
      // demo mode tops out at ~10 products. The enrichment is best-effort —
      // any product we can't resolve gets vendorName: "" so filters/sort
      // still work.
      const productsList = await ctx.api.products.list({ size: 500 }).catch(() => null);
      const productVendor = new Map<string, string>();
      const productNamesById = new Map<string, string>();
      if (productsList) {
        for (const p of productsList.content as Product[]) {
          if (p.vendorName) productVendor.set(p.id, p.vendorName);
          productNamesById.set(p.id, p.name);
        }
      }

      spinner.stop();

      const report = getUpcomingRenewals(subsResult.content, withinDays);

      // Resolve currency from the first active sub that carries one — same
      // convention dashboard uses post-#440. Mixed-currency portfolios are
      // out of scope for v0.x.
      const activeSubs = subsResult.content.filter(
        (s: Subscription) => s.status === "Active",
      );
      const portfolioCurrency =
        activeSubs.find((s: Subscription) => s.currencyCode)?.currencyCode ?? "USD";

      const vendorFilter = options.vendor?.toLowerCase();
      const productFilter = options.product?.toLowerCase();

      const rows: RenewalRow[] = [];
      for (const item of report.items) {
        // Find the underlying sub to read productId (RenewalItem doesn't
        // carry it). Fall back to "" if not found (shouldn't happen, but
        // keeps the vendor enrichment best-effort).
        const sub = subsResult.content.find(
          (s: Subscription) => s.id === item.subscriptionId,
        );
        const productId = sub?.productId ?? "";
        const vendorName = productVendor.get(productId) ?? "";

        if (vendorFilter && !vendorName.toLowerCase().includes(vendorFilter)) continue;
        if (productFilter && !item.productName.toLowerCase().includes(productFilter)) continue;

        rows.push({
          subscriptionId: item.subscriptionId,
          companyId: item.companyId,
          companyName: item.companyName,
          productName: item.productName,
          vendorName,
          quantity: item.quantity,
          monthlyCost: {
            amount: Number(item.mrrRenewing.toFixed(2)),
            currency: portfolioCurrency,
          },
          commitmentTermEndDate: item.renewalDate.toISOString().split("T")[0],
          daysUntilEnd: item.daysUntilRenewal,
        });
      }

      if (sort === "by-cost") {
        rows.sort((a, b) => b.monthlyCost.amount - a.monthlyCost.amount);
      } // by-date is already the default sort from getUpcomingRenewals.

      const totalMonthly = rows.reduce((sum, r) => sum + r.monthlyCost.amount, 0);

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify(
            {
              windowDays: withinDays,
              renewals: rows,
              totalCount: rows.length,
              totalMonthlyCostExposure: {
                amount: Number(totalMonthly.toFixed(2)),
                currency: portfolioCurrency,
              },
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(rows, {
          format: "csv",
          columns: tableColumns.map((c) =>
            c.key === "monthlyCost"
              ? { ...c, format: (v) => String((v as AmountCurrency).amount) }
              : c,
          ),
        });
        return;
      }

      if (rows.length === 0) {
        output([], {
          format: "table",
          columns: tableColumns,
          emptyState: {
            headline: `No commitments ending within ${withinDays} days.`,
            filtersApplied: {
              within: `${withinDays}d`,
              ...(options.company ? { company: options.company } : {}),
              ...(options.vendor ? { vendor: options.vendor } : {}),
              ...(options.product ? { product: options.product } : {}),
            },
            suggestions: [
              { command: "pax8 report renewals --within 365", description: "Widen the window" },
              { command: "pax8 report subscriptions --by vendor", description: "See what you're paying Pax8 for today" },
            ],
          },
        });
        return;
      }

      output(rows, { format: "table", columns: tableColumns });
      process.stdout.write(
        `\n  ${rows.length} renewal${rows.length === 1 ? "" : "s"} within ${withinDays} days — ${formatCurrency(totalMonthly)}/mo Pax8 cost exposure\n\n`,
      );
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to fetch renewals");
    }
  });
