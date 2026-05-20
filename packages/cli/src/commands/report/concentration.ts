// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import {
  ALL_SUBS_PAGE_SIZE,
  ERROR_INVALID_INPUT,
  subscriptionMrr,
  type AmountCurrency,
  type Product,
  type Subscription,
} from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { formatCompanyName, formatCurrency } from "../../lib/formatters.js";
import { enrichCompanyNames, enrichProductNames } from "../../lib/enrich-subscriptions.js";

type GroupBy = "client" | "vendor" | "product";

interface ConcentrationOptions {
  by?: string;
  top?: string;
  threshold?: string;
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

interface ConcentrationRow {
  rank: number;
  entityId: string;
  entityName: string;
  activeSubscriptionCount: number;
  monthlyCost: AmountCurrency;
  sharePercent: number;
  cumulativeSharePercent: number;
}

function parseGroupBy(raw: string | undefined): GroupBy {
  // Commander enforces --by required at parse time via .requiredOption(),
  // so a missing value here would be a programming error rather than a
  // user error. We still guard defensively in case the field is reused.
  if (!raw) {
    throw new CliError(
      "--by is required for `pax8 report concentration`.",
      undefined,
      ["Use --by client, --by vendor, or --by product."],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  const v = raw.toLowerCase();
  if (BY_ALIASES[v]) {
    process.stderr.write(
      `  ⚠ --by ${v} is deprecated; use --by client instead.\n`,
    );
    return BY_ALIASES[v];
  }
  if (v === "client" || v === "vendor" || v === "product") return v;
  throw new CliError(
    `Invalid --by value: "${raw}".`,
    undefined,
    ["Use --by client, --by vendor, or --by product."],
    undefined,
    ERROR_INVALID_INPUT,
  );
}

function parsePositiveInt(raw: string | undefined, flag: string): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new CliError(
      `Invalid ${flag} value: "${raw}".`,
      undefined,
      [`${flag} must be a positive integer.`],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return n;
}

function parseThreshold(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || n > 100) {
    throw new CliError(
      `Invalid --threshold value: "${raw}".`,
      undefined,
      ["--threshold must be a percentage between 0 and 100 (e.g. --threshold 10)."],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return n;
}

const tableColumns: Column[] = [
  { key: "rank", header: "#", format: (v) => String(v) },
  {
    key: "entityName",
    header: "Entity",
    format: (v) => formatCompanyName(String(v), 32),
  },
  {
    key: "activeSubscriptionCount",
    header: "Active subs",
    format: (v) => String(v),
  },
  {
    key: "monthlyCost",
    header: "Pax8 monthly cost",
    format: (v) => formatCurrency((v as AmountCurrency).amount),
  },
  {
    key: "sharePercent",
    header: "Share %",
    format: (v) => `${(v as number).toFixed(1)}%`,
  },
  {
    key: "cumulativeSharePercent",
    header: "Cumulative %",
    format: (v) => `${(v as number).toFixed(1)}%`,
  },
];

export const reportConcentrationCommand = new Command("concentration")
  .description(
    "Pax8 spend concentration analysis. Shows where your Pax8 cost is concentrated across customers, vendors, or products — useful for risk modeling and capacity planning.",
  )
  // .requiredOption() lets Commander reject `pax8 report concentration`
  // with no `--by` at parse time — no spinner, no fetch, no fallback to
  // the deferred CliError throw in parseGroupBy() (#517).
  .requiredOption("--by <client|vendor|product>", "Concentration axis (required)")
  .option("--top <n>", "Limit to the top N entities", "10")
  .option(
    "--threshold <pct>",
    "Show entities representing more than this percent of total Pax8 cost (alternative to --top)",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 report concentration --by client
  pax8 report concentration --by vendor --top 5
  pax8 report concentration --by product --threshold 5
  pax8 report concentration --by client --json

JSON output (--json):
  {
    "groupBy": "client" | "vendor" | "product",
    "totalMonthlyCost": { "amount": number, "currency": string },
    "concentration": [{
      "rank": number,
      "entityId": string,
      "entityName": string,
      "activeSubscriptionCount": number,
      "monthlyCost": { "amount": number, "currency": string },
      "sharePercent": number,
      "cumulativeSharePercent": number
    }]
  }

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`,
  )
  .action(async (options: ConcentrationOptions, cmd: Command) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const groupBy = parseGroupBy(options.by);
      const top = parsePositiveInt(options.top, "--top");
      const threshold = parseThreshold(options.threshold);

      // --threshold takes precedence when both are passed, per the spec. We
      // explicitly note this to the user via stderr so they know which
      // filter we honored.
      const useThreshold = threshold !== undefined;
      if (useThreshold && options.top !== undefined && options.top !== "10") {
        process.stderr.write(
          `  ℹ Both --threshold and --top specified; honoring --threshold ${threshold}%.\n`,
        );
      }

      const [subsResult, companiesResult, productsResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE }),
        ctx.api.companies.list({ size: 200 }),
        ctx.api.products.list({ size: 500 }).catch(() => null),
      ]);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) companyNames.set(c.id, c.name);
      enrichCompanyNames(companyNames, subsResult.content);
      await enrichProductNames(ctx, subsResult.content as Record<string, unknown>[]);

      const productVendor = new Map<string, string>();
      if (productsResult) {
        for (const p of productsResult.content as Product[]) {
          if (p.vendorName) productVendor.set(p.id, p.vendorName);
        }
      }

      spinner.stop();

      const activeSubs = subsResult.content.filter(
        (s: Subscription) => s.status === "Active",
      );
      const portfolioCurrency =
        activeSubs.find((s: Subscription) => s.currencyCode)?.currencyCode ?? "USD";

      // Per-entity rollup. Key is groupBy-dependent; we keep `id` separate
      // from `name` so that company groupings render the UUID under
      // `entityId` (canonical) while still showing the human name.
      interface Bucket {
        id: string;
        name: string;
        count: number;
        cost: number;
      }
      const buckets = new Map<string, Bucket>();
      let total = 0;

      for (const sub of activeSubs as Subscription[]) {
        const cost = subscriptionMrr(
          sub.price ?? 0,
          sub.quantity ?? 0,
          String(sub.billingTerm ?? "Monthly"),
        );
        total += cost;

        let id: string;
        let name: string;
        if (groupBy === "client") {
          id = sub.companyId;
          name = sub.companyName ?? sub.companyId;
        } else if (groupBy === "vendor") {
          const vendor = productVendor.get(sub.productId) ?? "Unknown vendor";
          id = vendor;
          name = vendor;
        } else {
          id = sub.productId;
          name = sub.productName ?? sub.productId;
        }

        const existing = buckets.get(id);
        if (existing) {
          existing.count += 1;
          existing.cost += cost;
        } else {
          buckets.set(id, { id, name, count: 1, cost });
        }
      }

      const sorted = [...buckets.values()].sort((a, b) => b.cost - a.cost);

      // Build rows with share + cumulative share. We compute these BEFORE
      // applying --top / --threshold so the cumulative number reflects the
      // entity's share of the whole portfolio (not the displayed subset).
      let cumulative = 0;
      const ranked = sorted.map((b, i): ConcentrationRow => {
        const share = total > 0 ? (b.cost / total) * 100 : 0;
        cumulative += share;
        return {
          rank: i + 1,
          entityId: b.id,
          entityName: b.name,
          activeSubscriptionCount: b.count,
          monthlyCost: {
            amount: Number(b.cost.toFixed(2)),
            currency: portfolioCurrency,
          },
          sharePercent: Number(share.toFixed(2)),
          cumulativeSharePercent: Number(cumulative.toFixed(2)),
        };
      });

      let rows: ConcentrationRow[];
      if (useThreshold) {
        rows = ranked.filter((r) => r.sharePercent > (threshold as number));
      } else {
        rows = ranked.slice(0, top ?? 10);
      }

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify(
            {
              groupBy,
              totalMonthlyCost: {
                amount: Number(total.toFixed(2)),
                currency: portfolioCurrency,
              },
              concentration: rows,
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
            headline: useThreshold
              ? `No ${groupBy}s exceed ${threshold}% of total Pax8 cost.`
              : `No ${groupBy} concentration data found.`,
            suggestions: [
              { command: "pax8 report subscriptions --by " + groupBy, description: "See the full breakdown" },
              { command: "pax8 dashboard --json", description: "Portfolio overview" },
            ],
          },
        });
        return;
      }

      output(rows, { format: "table", columns: tableColumns });
      process.stdout.write(
        `\n  Total Pax8 monthly cost across ${ranked.length} ${groupBy}${ranked.length === 1 ? "" : "s"}: ${formatCurrency(total)}\n\n`,
      );
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to compute concentration");
    }
  });
