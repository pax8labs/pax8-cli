// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ALL_SUBS_PAGE_SIZE, getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, warnIfTruncated, type CommandContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { filterRecommendations } from "./filter.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { resolveCommitmentTermId } from "../../lib/resolve-commitment.js";
import { validateEnum } from "../../lib/validate.js";

// `filter.ts` lowercases the priority/type before comparing, so we accept
// any casing from the CLI but only the canonical set survives validation.
// Per #408: a typo'd `--priority Hgih` previously slipped through, the
// filter matched nothing, and the user got an empty list with no clue why.
const PRIORITY_VALUES = ["high", "medium", "low"] as const;
const RECOMMENDATION_TYPE_VALUES = ["seat_gap", "cross_sell"] as const;

const columns: Column[] = [
  {
    key: "_num",
    header: "#",
  },
  {
    key: "priority",
    header: "Priority",
    format: (v) => {
      const p = String(v);
      if (p === "high") return chalk.red.bold("HIGH");
      if (p === "medium") return chalk.yellow("MED");
      return chalk.dim("LOW");
    },
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "type", header: "Type", format: (v) => String(v) === "seat_gap" ? "Seat Gap" : "Cross-sell" },
  { key: "title", header: "Recommendation" },
  {
    key: "estimatedMrrUplift",
    header: "Pax8 Cost+",
    format: (v) => (v != null ? formatCurrency(v as number) : chalk.dim("—")),
  },
];

async function promptLine(question: string): Promise<string> {
  const { createInterface } = await import("readline");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export const recommendationsListCommand = new Command("list")
  .description("Analyze customer portfolios and recommend products")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .option("--type <type>", "Filter by type (seat_gap or cross_sell)")
  .option("--product <name>", "Filter by product name (e.g. 'AvePoint', 'Entra')")
  .option("--include-all", "Show all recommendations including ones without orderable products")
  .option("--with-actions", "Wrap JSON output as { recommendations, nextActions, unmatchedProducts } instead of a flat array")
  .option("--limit <number>", "Max rows to show in table (default 10)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations list
  pax8 recommendations list --priority high
  pax8 recommendations list --company "Summit Healthcare"
  pax8 recommendations list --json

Recommendation types:
  Each recommendation carries TWO classification axes in --json output:
  the legacy 'type' field (cross_sell | seat_gap) and the additive
  'opportunityType' field with OE's canonical 5-type taxonomy (Upsell |
  Cross-sell | Add-on | Upgrade | Net-new). Mapping:
    type=cross_sell + active subs    → opportunityType=Cross-sell
    type=cross_sell + zero-sub cust  → opportunityType=Net-new
    type=seat_gap                    → opportunityType=Upsell

  cross_sell: gaps in a customer's stack where a complementary product
  category is missing. Aligns with Pax8 Opportunity Explorer's Cross-sell
  category for active-sub customers, and Net-new for zero-sub customers
  (carried on 'opportunityType'). The legacy 'type' field collapses both
  motions onto 'cross_sell' for v0.x; the full taxonomy migration is
  deferred to v0.2 (#375) and ARC-785.

  seat_gap: a CLI-invented heuristic that flags cross-product seat
  mismatches (e.g. 100 email seats but only 30 backup seats). Identifies
  coverage gaps across a customer's stack — NOT the same as Pax8's
  canonical Seat Utilization metric, which measures single-product
  assigned-vs-purchased seats. Closest OE surrogate is Upsell (carried
  on 'opportunityType'); seat_gap will likely be retired or remapped
  when OE's first-party API ships.

Estimate semantics:
  estimatedMrrUplift is an upper-bound estimate of the additional Pax8
  monthly cost (unit price × seat count) the partner would pay if they
  acted on the rec. It is the partner's cost-to-Pax8 increase, not
  partner-side resale revenue, and is NOT equivalent to Pax8's PMRR
  (Potential MRR) metric, which uses ML-based seat estimation. Use it
  as a directional ceiling, not a forecast. Field name preserved as
  estimatedMrrUplift on the wire-side @pax8/core Recommendation type;
  the CLI's user-visible label uses Pax8-cost framing.

JSON output (--json):
  Default: a flat array of Recommendation objects. With --with-actions,
  wrapped as { recommendations, nextActions, unmatchedProducts }.

  Recommendation = {
    "companyId": string,
    "companyName": string,
    "type": "seat_gap" | "cross_sell",   // CLI-local taxonomy; see Recommendation types above
    "opportunityType": "Upsell" | "Cross-sell" | "Add-on" | "Upgrade" | "Net-new",
                                          // OE canonical 5-type taxonomy (additive, mapped from "type")
    "priority": "high" | "medium" | "low",
    "title": string,
    "reason": string,
    "suggestedProducts": string[],        // human-readable product names
    "orderCommand": string | null,        // ready-to-run "pax8 orders create ..." command;
                                          // null if no orderable product matched in your catalog
    "productAvailable": boolean,          // true when orderCommand resolves to a real product
    "currentMrr": number,                 // company's current Pax8 monthly cost (context). Wire-side
                                          //   field name preserved on @pax8/core; user-facing labels
                                          //   use Pax8-cost framing.
    "estimatedMrrUplift": number,         // upper-bound additional Pax8 monthly cost — see Estimate
                                          //   semantics above; NOT Pax8 PMRR. Wire-side name preserved.
    "targetSeats": number,
    "estimateType": "upper_bound"
  }

  Note on STAX divergence: the CLI uses a local 7-category product
  taxonomy (productivity, email, security, endpoint_protection,
  identity, backup, cloud_infrastructure) and a "seat_gap" heuristic
  that are NOT Pax8's canonical STAX taxonomy or Seat Utilization
  metric. See "Metric definitions" in README.md and the module
  docstring at packages/core/src/services/recommendations.ts. Will
  sunset when OE's first-party /opportunities API ships (ARC-785, #375).`
  )
  .allowExcessArguments(true)
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();

    // When the user forgets quotes (e.g. --company [DEMO] Client 52),
    // Commander only captures "[DEMO]" and the rest become excess args.
    // Rejoin them so the filter works as intended.
    if (options.company && cmd.args.length > 0) {
      options.company = [options.company, ...cmd.args].join(" ");
    }

    // Fail-fast on typo'd `--priority` or `--type` BEFORE buildContext /
    // any network call (#408). The downstream filter silently dropped
    // unknown values, leaving the partner staring at an empty table.
    try {
      validateEnum(options.priority, PRIORITY_VALUES, "--priority", {
        lowercase: true,
        cmdHint: "pax8 recommendations list",
      });
      validateEnum(options.type, RECOMMENDATION_TYPE_VALUES, "--type", {
        lowercase: true,
        cmdHint: "pax8 recommendations list",
      });
    } catch (error) {
      await handleCommandError(error);
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing customer portfolios...").start();

    try {
      // Fetch subscriptions, companies, and enrich product names — all in parallel where possible
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      warnIfTruncated(subsResult, ALL_SUBS_PAGE_SIZE);

      // Build company name lookup
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      // Enrich subscriptions with product names (individual lookups, cached)
      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);

      // Also enrich company names on subscriptions
      enrichCompanyNames(companyNames, subs);

      spinner.stop();

      // Fetch products for order command matching
      const productsResult = await ctx.api.products.list({ size: 200 });
      const report = getRecommendations(
        subs,
        productsResult.content,
        companiesResult.content,
      );

      let recs = report.recommendations;

      recs = filterRecommendations(recs, options);

      if (ctx.outputFormat === "json") {
        if (options.withActions) {
          const nextActions = recs
            .filter((r) => r.orderCommand)
            .slice(0, 5)
            .map((r) => ({
              command: r.orderCommand!,
              description: `${r.title} for ${r.companyName}`,
            }));
          process.stdout.write(JSON.stringify({ recommendations: recs, nextActions, unmatchedProducts: report.unmatchedProducts }, null, 2) + "\n");
        } else {
          process.stdout.write(JSON.stringify(recs, null, 2) + "\n");
        }
        return;
      }

      // In table mode, hide unavailable recs unless --include-all
      // Count hidden items BEFORE filtering so we can show "N hidden" message
      const hiddenCount = options.includeAll ? 0 : recs.filter((r) => !r.productAvailable).length;
      if (!options.includeAll) {
        recs = recs.filter((r) => r.productAvailable);
      }

      // From this point, `recs` contains only the VISIBLE recommendations.
      // All summary counts must use `recs` (not `report.recommendations`) to
      // ensure the numbers the user sees match the items actually displayed.

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(recs, { format: "csv", columns });
        return;
      }

      if (recs.length === 0) {
        if (hiddenCount > 0) {
          process.stderr.write(
            chalk.yellow(`\n  ${hiddenCount} gap${hiddenCount > 1 ? "s" : ""} found but the needed products aren't in your catalog yet.\n\n`) +
            chalk.dim("  Your customers could benefit from:\n")
          );
          // Show what categories are missing
          const missingCategories = new Set(report.recommendations.filter((r) => !r.productAvailable).map((r) => r.title.replace(/for .+$/, "").trim()));
          for (const cat of missingCategories) {
            process.stderr.write(chalk.dim(`    • ${cat}\n`));
          }
          process.stderr.write(chalk.dim(`\n  Ask your Pax8 rep to enable these product categories.\n`));
          process.stderr.write(chalk.dim(`  Use ${chalk.cyan("--include-all")} to see details.\n\n`));
        } else {
          process.stdout.write(
            chalk.green("\n  ✨ All customers look well-covered — nice work!\n\n")
          );
        }
        return;
      }

      // Number the recs for interactive selection, cap table output
      // If total recs fit comfortably (≤15), show them all regardless of limit
      const requestedLimit = parseInt(options.limit, 10) || 10;
      const limit = recs.length <= 15 ? recs.length : requestedLimit;
      const displayRecs = recs.slice(0, limit);
      const numbered = displayRecs.map((r, i) => ({ ...r, _num: String(i + 1) }));
      output(numbered, { format: "table", columns });

      // Summary footer — all counts derived from visible `recs` only
      const highCount = recs.filter((r) => r.priority === "high").length;
      const totalUplift = recs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
      const actionableCount = recs.filter((r) => r.orderCommand).length;

      if (recs.length > limit) {
        process.stderr.write(chalk.dim(`\n  Showing top ${limit} of ${recs.length} recommendations`) + chalk.dim(` · use --limit ${recs.length} to see all\n`));
      }

      const visibleCompanyCount = new Set(recs.map((r) => r.companyId)).size;
      process.stderr.write(
        chalk.dim(
          `\n  ${recs.length} recommendation${recs.length !== 1 ? "s" : ""} across ${visibleCompanyCount} ${visibleCompanyCount !== 1 ? "companies" : "company"}`
        )
      );

      if (highCount > 0) {
        process.stderr.write(chalk.red.bold(` — ${highCount} high priority`));
      }

      if (totalUplift > 0) {
        process.stderr.write(
          chalk.green(` — ${formatCurrency(totalUplift)}/mo additional Pax8 monthly cost`)
        );
      }

      process.stderr.write("\n");

      if (totalUplift >= 5000) {
        process.stderr.write(chalk.cyan(`\n  💰 That's ${formatCurrency(totalUplift * 12)}/yr waiting to be captured.\n`));
      } else if (totalUplift >= 1000) {
        process.stderr.write(chalk.cyan(`\n  📈 A few conversations could add ${formatCurrency(totalUplift * 12)}/yr to your book.\n`));
      }

      // One-line "top N capture $X/mo" summary — replaces the old
      // multi-paragraph "Quick actions" block (issue #195). The block
      // re-printed every rec a second time AND leaked raw product UUIDs in
      // the `orders create --product <uuid>` snippets. The table above is
      // the menu; the `#` column + the `promptNextSteps` hint below already
      // give the user everything they need to drill in.
      const topN = Math.min(displayRecs.length, 5);
      const topUplift = displayRecs
        .slice(0, topN)
        .reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
      if (topUplift > 0 && recs.length > topN) {
        process.stderr.write(
          chalk.dim(`\n  Top ${topN} alone capture `) +
            chalk.green(`${formatCurrency(topUplift)}/mo`) +
            chalk.dim(".\n")
        );
      }

      if (hiddenCount > 0) {
        process.stderr.write(chalk.dim(`  ${hiddenCount} more recommendation${hiddenCount > 1 ? "s" : ""} hidden — no orderable products in catalog yet\n`));
      }

      // Suggest recommendations act
      process.stderr.write(chalk.dim(`  Walk through all: `) + chalk.cyan(replCmd("pax8 recommendations act")) + "\n");

      // Save pending actions for REPL mode
      try {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { homedir } = await import("os");
        const { join } = await import("path");
        const dir = join(homedir(), ".pax8");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "pending-actions.json"), JSON.stringify(
          displayRecs.map((r, i) => ({
            key: String(i + 1),
            rec: { companyId: r.companyId, companyName: r.companyName, title: r.title, orderCommand: r.orderCommand, suggestedProducts: r.suggestedProducts, targetSeats: r.targetSeats },
          }))
        ));
      } catch { /* best effort */ }

      // Interactive prompt — use shared promptNextSteps
      const steps: NextStep[] = displayRecs.map((r, i) => {
        if (r.orderCommand) {
          // Tokenize orderCommand, strip leading "pax8" if present
          const tokens = (r.orderCommand.match(/"[^"]*"|\S+/g) ?? []).map(
            (t) => t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t
          );
          const command = tokens[0] === "pax8" ? tokens.slice(1) : tokens;
          return {
            key: String(i + 1),
            label: `${r.suggestedProducts?.[0] ?? "product"} for ${r.companyName}`,
            command,
          };
        }
        return {
          key: String(i + 1),
          label: `Search for ${r.suggestedProducts?.[0] ?? "product"}`,
          command: ["products", "search", r.suggestedProducts?.[0] ?? "product"],
        };
      });
      await promptNextSteps(steps);
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to generate recommendations");
    }
  });
