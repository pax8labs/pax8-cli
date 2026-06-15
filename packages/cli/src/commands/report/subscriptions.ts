// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import {
  ERROR_INVALID_INPUT,
  subscriptionMrr,
  type AmountCurrency,
  type Product,
  type Subscription,
} from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { collectSubsWithSpinner } from "../../lib/subs-stream.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { formatCompanyName, formatCurrency } from "../../lib/formatters.js";
import { enrichCompanyNames, enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";

type GroupBy = "client" | "vendor" | "product" | "billing-term";

interface SubscriptionsOptions {
  by?: string;
  company?: string;
  vendor?: string;
}

// `client` is the canonical noun (per #317 — `pax8 clients *` is the
// canonical command surface). We accept `customer` and `company` as
// deprecated aliases and emit a one-line stderr warning so existing
// scripts keep working while the docs and tab-completion converge on
// `client`.
const BY_ALIASES: Record<string, "client"> = {
  customer: "client",
  company: "client",
};

interface SubscriptionsGroupRow {
  groupName: string;
  subscriptionCount: number;
  totalQuantity: number;
  monthlyCost: AmountCurrency;
  annualCost: AmountCurrency;
}

function parseGroupBy(raw: string | undefined): GroupBy {
  const v = (raw ?? "vendor").toLowerCase();
  if (BY_ALIASES[v]) {
    process.stderr.write(
      `  ⚠ --by ${v} is deprecated; use --by client instead.\n`,
    );
    return BY_ALIASES[v];
  }
  if (
    v === "client" ||
    v === "vendor" ||
    v === "product" ||
    v === "billing-term"
  )
    return v;
  throw new CliError(
    `Invalid --by value: "${raw}".`,
    undefined,
    ["Use --by client, --by vendor, --by product, or --by billing-term."],
    undefined,
    ERROR_INVALID_INPUT,
  );
}

const tableColumns: Column[] = [
  {
    key: "groupName",
    header: "Group",
    format: (v) => formatCompanyName(String(v), 32),
  },
  {
    key: "subscriptionCount",
    header: "Subs",
    format: (v) => String(v),
  },
  {
    key: "totalQuantity",
    header: "Total qty",
    format: (v) => String(v),
  },
  {
    key: "monthlyCost",
    header: "Pax8 monthly cost",
    format: (v) => formatCurrency((v as AmountCurrency).amount),
  },
  {
    key: "annualCost",
    header: "Pax8 annual cost",
    format: (v) => formatCurrency((v as AmountCurrency).amount),
  },
];

export const reportSubscriptionsCommand = new Command("subscriptions")
  .description(
    "Audit and group your active Pax8 commitments. Useful for periodic state checks, capacity audits, and identifying orphaned subscriptions.",
  )
  .option("--by <client|vendor|product|billing-term>", "Group axis", "vendor")
  .option("--company <id|name>", "Filter by company ID or name")
  .option("--vendor <name>", "Filter by vendor (e.g. Microsoft, AvePoint)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 report subscriptions
  pax8 report subscriptions --by client
  pax8 report subscriptions --by billing-term --json
  pax8 report subscriptions --company "Redwood Manufacturing"
  pax8 report subscriptions --vendor Microsoft

JSON output (--json):
  {
    "groupBy": "client" | "vendor" | "product" | "billing-term",
    "totalActiveSubscriptions": number,
    "totalMonthlyCost": { "amount": number, "currency": string },
    "groups": [{
      "groupName": string,
      "subscriptionCount": number,
      "totalQuantity": number,
      "monthlyCost": { "amount": number, "currency": string },
      "annualCost": { "amount": number, "currency": string }
    }]
  }

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`,
  )
  .action(async (options: SubscriptionsOptions, cmd: Command) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const groupBy = parseGroupBy(options.by);

      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;

      // #613 Phase 2: walk every page so the report aggregates over the
      // full subscription set. Pre-#628 the call was
      // `subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, companyId })`,
      // which silently truncated vendor / client / product group totals
      // for partners with >1000 subs (or >1000 subs at a single filtered
      // company). The grouped sums and the `groupName` rows would all
      // reflect the first-page sample instead of the portfolio.
      const [allSubs, companiesResult, productsResult] = await Promise.all([
        collectSubsWithSpinner(
          ctx.api.subscriptions.streamAll({ companyId }),
          spinner,
          "subscription report",
        ),
        ctx.api.companies.list({ size: 200 }),
        ctx.api.products.list({ size: 500 }).catch(() => null),
      ]);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) companyNames.set(c.id, c.name);
      enrichCompanyNames(companyNames, allSubs);
      await enrichProductNames(ctx, allSubs as Record<string, unknown>[]);

      const productVendor = new Map<string, string>();
      if (productsResult) {
        for (const p of productsResult.content as Product[]) {
          if (p.vendorName) productVendor.set(p.id, p.vendorName);
        }
      }

      spinner.stop();

      const vendorFilter = options.vendor?.toLowerCase();

      const activeSubs = (allSubs as Subscription[]).filter(
        (s) => s.status === "Active",
      );

      // Apply vendor filter (vendor isn't on Subscription directly — resolve
      // through the productId -> vendor map). Done after activeSubs so the
      // count + currency-resolution heuristic still reflects what survived
      // both filters.
      const filteredSubs = vendorFilter
        ? activeSubs.filter((s) => {
            const v = productVendor.get(s.productId)?.toLowerCase() ?? "";
            return v.includes(vendorFilter);
          })
        : activeSubs;

      const portfolioCurrency =
        filteredSubs.find((s) => s.currencyCode)?.currencyCode ?? "USD";

      interface Bucket {
        name: string;
        count: number;
        quantity: number;
        cost: number;
      }
      const buckets = new Map<string, Bucket>();
      let totalMonthly = 0;
      let totalSubs = 0;

      for (const sub of filteredSubs) {
        const cost = subscriptionMrr(
          sub.price ?? 0,
          sub.quantity ?? 0,
          String(sub.billingTerm ?? "Monthly"),
        );
        totalMonthly += cost;
        totalSubs += 1;

        let key: string;
        let name: string;
        if (groupBy === "client") {
          key = sub.companyId;
          name = sub.companyName ?? sub.companyId;
        } else if (groupBy === "vendor") {
          const v = productVendor.get(sub.productId) ?? "Unknown vendor";
          key = v;
          name = v;
        } else if (groupBy === "product") {
          key = sub.productId;
          name = sub.productName ?? sub.productId;
        } else {
          // billing-term
          key = String(sub.billingTerm ?? "Monthly");
          name = key;
        }

        const existing = buckets.get(key);
        if (existing) {
          existing.count += 1;
          existing.quantity += sub.quantity ?? 0;
          existing.cost += cost;
        } else {
          buckets.set(key, {
            name,
            count: 1,
            quantity: sub.quantity ?? 0,
            cost,
          });
        }
      }

      const groups: SubscriptionsGroupRow[] = [...buckets.values()]
        .sort((a, b) => b.cost - a.cost)
        .map((b) => ({
          groupName: b.name,
          subscriptionCount: b.count,
          totalQuantity: b.quantity,
          monthlyCost: {
            amount: Number(b.cost.toFixed(2)),
            currency: portfolioCurrency,
          },
          annualCost: {
            amount: Number((b.cost * 12).toFixed(2)),
            currency: portfolioCurrency,
          },
        }));

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify(
            {
              groupBy,
              totalActiveSubscriptions: totalSubs,
              totalMonthlyCost: {
                amount: Number(totalMonthly.toFixed(2)),
                currency: portfolioCurrency,
              },
              groups,
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(groups, {
          format: "csv",
          columns: tableColumns.map((c) =>
            c.key === "monthlyCost" || c.key === "annualCost"
              ? { ...c, format: (v) => String((v as AmountCurrency).amount) }
              : c,
          ),
        });
        return;
      }

      if (groups.length === 0) {
        output([], {
          format: "table",
          columns: tableColumns,
          emptyState: {
            headline: "No active subscriptions match these filters.",
            filtersApplied: {
              by: groupBy,
              ...(options.company ? { company: options.company } : {}),
              ...(options.vendor ? { vendor: options.vendor } : {}),
            },
            suggestions: [
              { command: "pax8 subscriptions list --status Active --json", description: "Inspect every active sub" },
              { command: "pax8 dashboard --json", description: "Portfolio overview" },
            ],
          },
        });
        return;
      }

      output(groups, { format: "table", columns: tableColumns });
      process.stdout.write(
        `\n  ${totalSubs} active subscription${totalSubs === 1 ? "" : "s"} across ${groups.length} ${groupBy === "billing-term" ? "billing term" : groupBy}${groups.length === 1 ? "" : "s"} — ${formatCurrency(totalMonthly)}/mo · ${formatCurrency(totalMonthly * 12)}/yr Pax8 cost\n\n`,
      );
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to compute subscriptions report");
    }
  });
