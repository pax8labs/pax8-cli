// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ALL_SUBS_PAGE_SIZE, getRecommendations, type Recommendation, ERROR_INVALID_INPUT } from "@pax8/core";
import { ask } from "../../lib/prompts.js";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { filterRecommendations } from "./filter.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { setTelemetryFields } from "../../lib/telemetry-context.js";
import { replCmd } from "../../lib/confirm.js";
import { resolveCommitmentTermId } from "../../lib/resolve-commitment.js";
import { validateEnum } from "../../lib/validate.js";

// Mirror `list`'s validation set — same downstream `filterRecommendations`.
const PRIORITY_VALUES = ["high", "medium", "low"] as const;

interface PlacementResult {
  ordered: boolean;
  mrrCaptured: number;
}

/**
 * Place a single order for an already-confirmed recommendation. No prompts —
 * the user has already approved the batch upstream (either via the
 * multi-select + confirm flow, or via the `--yes` bypass).
 */
async function placeOrder(rec: Recommendation, ctx: CommandContext): Promise<PlacementResult> {
  const product = rec.suggestedProducts?.[0] ?? "product";

  if (!rec.orderCommand && !rec.orderArgs) {
    process.stderr.write(chalk.dim(`  No orderable product available for ${rec.companyName} — skipping.\n`));
    return { ordered: false, mrrCaptured: 0 };
  }

  // #509: extract product / quantity from `orderArgs` (#498's structured
  // form) when present. Each argv element is a fixed slot — no string
  // tokenization, no regex parse, no need to survive shell metacharacters
  // in companyName. Fall back to the orderCommand regex parse for older
  // Recommendation rows from a pre-#498 build.
  let matchedProduct: string | undefined;
  let quantityStr: string | undefined;
  if (rec.orderArgs) {
    const productIdx = rec.orderArgs.indexOf("--product");
    const quantityIdx = rec.orderArgs.indexOf("--quantity");
    matchedProduct = productIdx >= 0 ? rec.orderArgs[productIdx + 1] : undefined;
    quantityStr = quantityIdx >= 0 ? rec.orderArgs[quantityIdx + 1] : undefined;
  } else if (rec.orderCommand) {
    const productMatch = rec.orderCommand.match(/--product\s+"([^"]+)"|--product\s+(\S+)/);
    const qtyMatch = rec.orderCommand.match(/--quantity\s+(\S+)/);
    matchedProduct = productMatch?.[1] ?? productMatch?.[2];
    quantityStr = qtyMatch?.[1];
  }

  if (!matchedProduct) {
    process.stderr.write(chalk.red(`  Could not parse order for ${rec.companyName}.\n`));
    return { ordered: false, mrrCaptured: 0 };
  }

  const quantity = parseInt(quantityStr ?? String(rec.targetSeats ?? 1), 10);

  // Resolve product: try the matched value as a product ID first, fall back
  // to a name search.
  let productId = matchedProduct;
  if (matchedProduct && !/^[0-9a-f-]{8,}$/i.test(matchedProduct) && !matchedProduct.startsWith("prod-")) {
    try {
      const searchResult = await ctx.api.products.search(matchedProduct);
      const match = searchResult.content.find(
        (p: { name: string; id: string }) => p.name.toLowerCase() === matchedProduct.toLowerCase()
      );
      if (match) productId = match.id;
    } catch { /* use as-is */ }
  }

  const spinner = createSpinner(`Ordering ${product} for ${rec.companyName}...`).start();
  try {
    // Resolve commitmentTermId from existing subscription for the SAME product.
    const commitmentInfo = await resolveCommitmentTermId(ctx, rec.companyId, productId);
    const commitmentTermId = commitmentInfo?.id;

    const doneOrder = markWriteInFlight("orders");
    let order;
    try {
      order = await ctx.api.orders.create({
        companyId: rec.companyId,
        lineItems: [{
          productId,
          // `lineItemNumber` is spec-required on every line item (#331). The
          // recommendation flow always submits a single line, so it's 1.
          lineItemNumber: 1,
          quantity,
          billingTerm: "Monthly",
          ...(commitmentTermId ? { commitmentTermId } : {}),
        }],
      });
    } finally {
      doneOrder();
    }

    // Look up unit price from product pricing.
    let unitPrice: number | null = null;
    try {
      const pricing = await ctx.api.products.getPricing(productId).catch(() => null);
      if (pricing && pricing.length > 0) {
        const match = pricing.find((p: { billingTerm: string }) => p.billingTerm === "Monthly")
          ?? pricing[0];
        const ratePrice = match.rates?.[0]?.suggestedRetailPrice
          ?? (match as Record<string, unknown>).suggestedRetailPrice as number | undefined;
        if (ratePrice) unitPrice = ratePrice;
      }
    } catch { /* best effort */ }

    const monthlyCost = unitPrice ? calculateMrr(unitPrice, quantity, "Monthly") : null;
    const annualCost = monthlyCost ? Number((monthlyCost * 12).toFixed(2)) : null;

    const displayMrr = monthlyCost ?? (rec.estimatedMrrUplift
      ? (rec.targetSeats && quantity !== rec.targetSeats
        ? Number((rec.estimatedMrrUplift * (quantity / rec.targetSeats)).toFixed(2))
        : rec.estimatedMrrUplift)
      : null);
    const displayAnnual = annualCost ?? (displayMrr ? Number((displayMrr * 12).toFixed(2)) : null);

    spinner.succeed(`Ordered ${product} for ${rec.companyName} (${quantity} seats)`);

    process.stderr.write("\n");
    process.stderr.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
    process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${product}\n`);
    process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${rec.companyName}\n`);
    process.stderr.write(`  ${chalk.dim("Seats:".padEnd(18))}${formatQuantity(quantity)}\n`);
    if (unitPrice) {
      process.stderr.write(`  ${chalk.dim("Unit price:".padEnd(18))}${formatCurrency(unitPrice)}/seat/mo\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Unit price:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    if (displayMrr) {
      process.stderr.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.green.bold(formatCurrency(displayMrr) + "/mo")}\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    if (displayAnnual) {
      process.stderr.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.green(formatCurrency(displayAnnual) + "/yr")}\n`);
    } else {
      process.stderr.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.dim("—")}\n`);
    }
    process.stderr.write("\n");

    const mrrCaptured = displayMrr ?? rec.estimatedMrrUplift ?? 0;
    return { ordered: true, mrrCaptured };
  } catch (error) {
    spinner.fail(`Order failed for ${rec.companyName}`);
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(chalk.dim(`  ${msg.slice(0, 100)}\n`));
    return { ordered: false, mrrCaptured: 0 };
  }
}

/**
 * Build a one-line label for the multi-select picker. Companies with a
 * `[demo]` prefix get cleaned up via `formatCompanyName` for display.
 */
function recLabel(rec: Recommendation): string {
  const product = rec.suggestedProducts?.[0] ?? "product";
  const seats = rec.targetSeats ?? "?";
  const uplift = rec.estimatedMrrUplift
    ? ` (+${formatCurrency(rec.estimatedMrrUplift)}/mo)`
    : "";
  const kind = rec.type === "seat_gap" ? "Bump" : "Add";
  return `${formatCompanyName(rec.companyName)}: ${kind} ${product} (${seats} seats)${uplift}`;
}

export const recommendationsActCommand = new Command("act")
  .description("Pick recommendations from a multi-select picker and place orders in a batch (uses CLI-side heuristics; see Notes below)")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--product <name>", "Filter to a specific product (e.g. 'AvePoint', 'Entra')")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .option("-y, --yes", "Skip the picker and confirmation; place all matching recommendations")
  .allowExcessArguments(true)
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations act
  pax8 recommendations act --company "Summit Healthcare"
  pax8 recommendations act --priority high
  pax8 recommendations act --yes                    # non-interactive: place all

Notes — what this command acts on:
  The recommendations this command places orders against come from the
  CLI's LOCAL recommendation engine, not Pax8's canonical Opportunity
  Explorer (OE). The engine is provisional — it uses a CLI-local 7-category
  product taxonomy (productivity, email, security, endpoint_protection,
  identity, backup, cloud_infrastructure) and a "seat_gap" heuristic that
  are NOT Pax8's canonical STAX taxonomy or Seat Utilization metric. See
  the "Note on STAX divergence" section in 'pax8 recommendations list
  --help' for the full breakdown of what's CLI-invented vs canonical.

  estimatedMrrUplift on each recommendation is an upper-bound estimate
  (unit price × seat count) and is NOT equivalent to Pax8's PMRR
  (Potential MRR) metric. Treat order-placement decisions accordingly.

  This local engine will be retired or remapped when Pax8's first-party
  Opportunity Explorer API ships (#375).

What this command does:
  Bulk action submits REAL orders to Pax8 via the orders API — one POST
  per recommendation in the selected set. In interactive (TTY) mode you
  pick from a multi-select picker and confirm before submission. With
  '--yes' or in non-interactive mode you opt in to skipping that gate;
  every matching recommendation in the filtered set is ordered without
  further prompting. Use the filter flags (--company, --product,
  --priority) to constrain the set before passing '--yes'.

Note: Numbers shown are Pax8 cost — what Pax8 charges you. For partner revenue (what you charge your customers), combine with sell-through pricing from your PSA.`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();

    // Rejoin excess args for unquoted company names
    if (options.company && cmd.args.length > 0) {
      options.company = [options.company, ...cmd.args].join(" ");
    }

    // Fail-fast on typo'd `--priority` BEFORE buildContext (#408).
    try {
      validateEnum(options.priority, PRIORITY_VALUES, "--priority", {
        lowercase: true,
        cmdHint: "pax8 recommendations act",
      });
    } catch (error) {
      await handleCommandError(error);
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing portfolios...").start();

    try {
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);
      enrichCompanyNames(companyNames, subs);

      const productsResult = await ctx.api.products.list({ size: 200 });
      const report = getRecommendations(subs, productsResult.content);

      let recs = report.recommendations.filter((r) => r.productAvailable);
      recs = filterRecommendations(recs, options);

      spinner.stop();

      if (recs.length === 0) {
        process.stderr.write(chalk.green("\n  No actionable recommendations.\n\n"));
        // Still emit zero-counters so dashboards see the run.
        setTelemetryFields({
          recs_presented: 0,
          recs_ordered: 0,
          recs_skipped: 0,
        });
        return;
      }

      // Recommendations arrive ranked by priority / additional Pax8 monthly
      // cost from getRecommendations(); preserve that order for the picker.
      const totalUplift = recs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
      const totalUpliftLabel = totalUplift > 0
        ? chalk.green(`${formatCurrency(totalUplift)}/mo additional Pax8 cost available`)
        : "";

      // Decide which recs to act on. Three paths:
      //   1. --yes: bypass prompts entirely → all recs.
      //   2. TTY interactive: multi-select picker + confirm.
      //   3. Non-TTY without --yes: error cleanly.
      let toPlace: Recommendation[];

      if (options.yes) {
        toPlace = recs;
        process.stderr.write(
          `\n  ${chalk.bold(`${recs.length} recommendations`)} for batch ordering` +
          (totalUpliftLabel ? ` — ${totalUpliftLabel}` : "") + ".\n"
        );
      } else if (!process.stdin.isTTY) {
        throw new CliError(
          "Cannot show interactive picker — stdin is not a TTY",
          ["pax8 recommendations act needs a terminal for the multi-select prompt"],
          [
            `Pass ${replCmd("--yes")} to place every matching recommendation without prompting`,
            `Filter the list first: ${replCmd("pax8 recommendations act")} --company "<name>" --yes`,
            `Or run ${replCmd("pax8 recommendations list --json")} to inspect them, then place orders individually with ${replCmd("pax8 orders create")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      } else {
        process.stderr.write(
          `\n  Found ${chalk.bold(`${recs.length} recommendations`)}` +
          (totalUpliftLabel ? ` — ${totalUpliftLabel}` : "") + ".\n\n"
        );

        const picked = await ask({
          type: "multiselect",
          name: "selected",
          message: "Select recommendations to act on",
          choices: recs.map((rec) => ({
            title: recLabel(rec),
            value: rec,
            selected: false,
          })),
          instructions: false,
          hint: "space to toggle, a to toggle all, enter to submit",
        });

        const selected = (picked.selected as Recommendation[] | undefined) ?? [];
        if (selected.length === 0) {
          process.stderr.write(chalk.dim("\n  No recommendations selected — nothing to do.\n\n"));
          setTelemetryFields({
            recs_presented: recs.length,
            recs_ordered: 0,
            recs_skipped: recs.length,
          });
          return;
        }

        const selectedUplift = selected.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
        const upliftStr = selectedUplift > 0
          ? ` for ${chalk.green(formatCurrency(selectedUplift) + "/mo")} additional Pax8 cost`
          : "";

        const confirmAnswer = await ask({
          type: "confirm",
          name: "go",
          message: `About to place ${selected.length} order${selected.length === 1 ? "" : "s"}${upliftStr}. Proceed?`,
          initial: false,
        });

        if (!confirmAnswer.go) {
          process.stderr.write(chalk.dim("\n  Not confirmed — no orders placed.\n\n"));
          setTelemetryFields({
            recs_presented: recs.length,
            recs_ordered: 0,
            recs_skipped: recs.length,
          });
          return;
        }

        toPlace = selected;
      }

      // Place each chosen order using the existing per-order placement logic.
      let ordered = 0;
      let mrrCaptured = 0;
      for (const rec of toPlace) {
        const result = await placeOrder(rec, ctx);
        if (result.ordered) {
          ordered++;
          mrrCaptured += result.mrrCaptured;
        }
      }
      const skipped = recs.length - ordered;

      // Summary
      process.stderr.write(chalk.dim("\n  ─────────────────────────────\n"));
      process.stderr.write(`  ${chalk.green.bold(`${ordered} ordered`)}`);
      if (skipped > 0) process.stderr.write(chalk.dim(` · ${skipped} skipped`));
      if (mrrCaptured > 0) process.stderr.write(chalk.green(` · ${formatCurrency(mrrCaptured)}/mo additional Pax8 monthly cost committed`));
      process.stderr.write("\n\n");

      // Contribute aggregate counts to the single command_executed event
      // emitted by the postAction hook (#146 — was double-firing).
      setTelemetryFields({
        recs_presented: recs.length,
        recs_ordered: ordered,
        recs_skipped: skipped,
        recs_mrr_captured: mrrCaptured > 0 ? mrrCaptured : undefined,
      });
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to process recommendations");
    }
  });
