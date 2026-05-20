// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { replCmd } from "../../lib/confirm.js";
import { formatCurrency } from "../../lib/formatters.js";
import { output } from "../../lib/output.js";
import {
  BillingTermSchema,
  ERROR_INVALID_INPUT,
  simulateCostChange,
  ALL_SUBS_PAGE_SIZE,
  type BillingTerm,
  type SimulationInput,
  type SimulationResult,
} from "@pax8/core";
import type { Subscription } from "@pax8/core";
import { resolveCompany } from "../../lib/resolve-company.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { validateEnum } from "../../lib/validate.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

const BILLING_TERM_VALUES = BillingTermSchema.options as readonly BillingTerm[];

/**
 * Pick the most plausible "current" subscription for a company × product pair.
 * Prefers Active subscriptions; falls back to the first match of any status.
 */
function pickCurrentSubscription(
  subs: Subscription[],
  productId: string,
): Subscription | undefined {
  const matching = subs.filter((s) => s.productId === productId);
  if (matching.length === 0) return undefined;
  return (
    matching.find((s) => (s.status ?? "").toLowerCase() === "active") ??
    matching[0]
  );
}

function deltaSign(n: number): string {
  if (n > 0) return "+";
  if (n < 0) return ""; // formatCurrency handles the leading '-'
  return "";
}

export const costSimCommand = new Command("sim")
  .description("Simulate the financial impact of a subscription change before placing the order")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .requiredOption("--product <id|name>", "Proposed product ID or name (required)")
  .option("--quantity <number>", "Proposed quantity", "1")
  .option(
    "--from <id|name>",
    "Current product (for SKU swaps). Omit to model a quantity change on --product, or to model an add-new.",
  )
  .option(
    "--from-quantity <number>",
    "Current quantity. Defaults to the existing subscription's quantity, or 0 if no current subscription.",
  )
  .option(
    "--billing-term <term>",
    "Billing term for the proposed subscription (Monthly or Annual)",
    "Annual",
  )
  .addHelpText(
    "after",
    `
Examples:
  # Bump M365 Business Premium from current quantity to 50 seats
  pax8 cost sim --company "Pinnacle Financial Advisors" --product "M365 Business Premium" --quantity 50

  # Upgrade SKU: Business Basic → Business Premium, keep 25 seats
  pax8 cost sim --company "Bright Minds Academy" --product "M365 Business Premium" --from "M365 Business Basic" --quantity 25

  # Add a brand-new product (no current subscription)
  pax8 cost sim --company "Coastline Legal Group" --product "AvePoint Cloud Backup" --quantity 30 --json

JSON output (--json):
  {
    "companyName": string,
    "companyId": string,
    "current": {                          // null on add-new (no existing sub)
      "productName": string,
      "billingTerm": "Monthly" | "Annual",
      "quantity": number,
      "unitPrice": number,
      "monthly": number,                  // normalized monthly cost
      "annual": number                    // normalized annual cost
    } | null,
    "proposed": {                         // same shape as "current"
      "productName": string,
      "billingTerm": "Monthly" | "Annual",
      "quantity": number,
      "unitPrice": number,
      "monthly": number,
      "annual": number
    },
    "delta": {
      "monthly": number,                  // proposed.monthly − current.monthly
      "annual": number,                   // proposed.annual − current.annual
      "perSeat": number                   // per-seat monthly delta
    },
    "notes": string[],                    // human-readable caveats (e.g. SKU swap, term change)
    "nextActions": [{                     // ready-to-run follow-up commands
      "command": string,                  // e.g. "pax8 orders create --company ..."
      "description": string
    }]
  }`,
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    // Fail-fast on typo'd `--billing-term` BEFORE any network call (#408).
    try {
      validateEnum(allOpts.billingTerm, BILLING_TERM_VALUES, "--billing-term", {
        cmdHint: "pax8 cost sim",
      });
    } catch (error) {
      await handleCommandError(error);
    }
    const spinner = createSpinner("Resolving company and product...");

    try {
      const ctx = await buildContext(allOpts);
      const proposedQuantity = parseInt(allOpts.quantity, 10);

      if (isNaN(proposedQuantity) || proposedQuantity < 0) {
        throw new CliError(
          `Invalid quantity: "${allOpts.quantity}"`,
          ["Quantity must be a non-negative integer."],
          [`Example: ${replCmd("pax8 cost sim")} --company <name> --product <name> --quantity 25`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      spinner.start();

      // Resolve company (hard requirement)
      const company = await resolveCompany(ctx, allOpts.company);

      // Resolve proposed product
      const proposedProduct = await resolveProduct(ctx, allOpts.product);

      // Fetch the company's existing subscriptions — used to:
      //   (a) auto-detect a current subscription matching --product (when --from is omitted)
      //   (b) pull the current quantity/price/billingTerm for the "current" leg
      let companySubs: Subscription[] = [];
      try {
        const subsResult = await ctx.api.subscriptions.list({
          companyId: company.id,
          size: ALL_SUBS_PAGE_SIZE,
        });
        companySubs = subsResult.content;
      } catch {
        // Best-effort: if the subscriptions list fails, we can still
        // simulate against an empty current state (i.e. add-new).
      }

      // Resolve the "current" leg. Track the matched subscription so the
      // "Try next" block below can offer a pickable drill-in to it.
      let currentInput: SimulationInput["current"] | undefined;
      let affectedSubscriptionId: string | undefined;
      // Currency for output rendering — inherited from the matched current
      // subscription when one exists (#472). Cost-sim is a single-record
      // simulation so the currency is unambiguous; defaults to USD when no
      // current sub is present (add-new path).
      let displayCurrency: string = "USD";
      if (allOpts.from) {
        // Explicit --from: resolve it as a separate product.
        const fromProduct = await resolveProduct(ctx, allOpts.from);
        const existing = pickCurrentSubscription(companySubs, fromProduct.id);
        affectedSubscriptionId = existing?.id;
        const fromQty = allOpts.fromQuantity !== undefined
          ? parseInt(allOpts.fromQuantity, 10)
          : existing?.quantity ?? 0;
        if (isNaN(fromQty) || fromQty < 0) {
          throw new CliError(
            `Invalid --from-quantity: "${allOpts.fromQuantity}"`,
            ["Must be a non-negative integer."],
            [],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        // Resolve current price + billingTerm. Prefer the existing
        // subscription's actual numbers; fall back to the product's pricing.
        let price: number | undefined = existing?.price;
        let billingTerm: string | undefined = existing?.billingTerm;
        if (price === undefined || billingTerm === undefined) {
          const fromPricing = await ctx.api.products
            .getPricing(fromProduct.id)
            .catch(() => null);
          const wantTerm = (billingTerm ?? "Annual").toLowerCase();
          const plan = fromPricing?.find((p) => p.billingTerm.toLowerCase() === wantTerm)
            ?? fromPricing?.[0];
          if (plan) {
            price = price ?? plan.rates?.[0]?.suggestedRetailPrice ?? 0;
            billingTerm = billingTerm ?? plan.billingTerm;
          }
        }
        currentInput = {
          productId: fromProduct.id,
          productName: fromProduct.name,
          quantity: fromQty,
          billingTerm: billingTerm ?? "Monthly",
          price: price ?? 0,
        };
        if (existing?.currencyCode) displayCurrency = existing.currencyCode;
      } else {
        // No --from: try to auto-detect a matching subscription on the proposed product.
        const existing = pickCurrentSubscription(companySubs, proposedProduct.id);
        affectedSubscriptionId = existing?.id;
        if (existing && (existing.price !== undefined) && (existing.billingTerm !== undefined)) {
          currentInput = {
            productId: proposedProduct.id,
            productName: proposedProduct.name,
            quantity: existing.quantity ?? 0,
            billingTerm: existing.billingTerm,
            price: existing.price,
          };
          if (existing.currencyCode) displayCurrency = existing.currencyCode;
        }
        // If no existing match, currentInput stays undefined → add-new simulation.
      }

      // Fetch pricing for the proposed product
      const proposedPricing = await ctx.api.products
        .getPricing(proposedProduct.id)
        .catch(() => null);

      spinner.stop();

      if (!proposedPricing || proposedPricing.length === 0) {
        throw new CliError(
          `No pricing data available for "${proposedProduct.name}"`,
          ["The Pax8 API returned no pricing plans for this product."],
          [
            `View product details: ${replCmd("pax8 products show")} ${proposedProduct.id}`,
            "Some products require contacting Pax8 for a quote — they have no public pricing.",
          ],
        );
      }

      let result: SimulationResult;
      try {
        result = simulateCostChange({
          current: currentInput,
          proposed: {
            productId: proposedProduct.id,
            productName: proposedProduct.name,
            quantity: proposedQuantity,
            billingTerm: allOpts.billingTerm,
          },
          pricing: proposedPricing,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new CliError(
          `Simulation failed: ${msg}`,
          [],
          [
            `Verify pricing exists: ${replCmd("pax8 products show")} ${proposedProduct.id}`,
            "Or try a different --billing-term (Monthly | Annual).",
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // ── Output ─────────────────────────────────────────────────────────────

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "json") {
        const nextActions = [
          {
            command: `pax8 orders create --company "${company.name}" --product "${proposedProduct.name}" --quantity ${proposedQuantity} --billing-term ${result.proposed.billingTerm}`,
            description: `Place this change as an order for ${company.name}`,
          },
        ];
        process.stdout.write(
          JSON.stringify(
            {
              companyName: company.name,
              companyId: company.id,
              ...result,
              nextActions,
            },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "csv") {
        const rows: Array<Record<string, string | number>> = [];
        if (result.current) {
          rows.push({
            scenario: "current",
            productName: result.current.productName,
            billingTerm: result.current.billingTerm,
            quantity: result.current.quantity,
            unitPrice: result.current.unitPrice,
            monthly: result.current.monthly,
            annual: result.current.annual,
          });
        }
        rows.push({
          scenario: "proposed",
          productName: result.proposed.productName,
          billingTerm: result.proposed.billingTerm,
          quantity: result.proposed.quantity,
          unitPrice: result.proposed.unitPrice,
          monthly: result.proposed.monthly,
          annual: result.proposed.annual,
        });
        rows.push({
          scenario: "delta",
          productName: "",
          billingTerm: "",
          quantity: 0,
          unitPrice: 0,
          monthly: result.delta.monthly,
          annual: result.delta.annual,
        });
        output(rows, {
          format: "csv",
          columns: [
            { key: "scenario", header: "Scenario" },
            { key: "productName", header: "Product" },
            { key: "billingTerm", header: "Billing Term" },
            { key: "quantity", header: "Quantity" },
            { key: "unitPrice", header: "Unit Price" },
            { key: "monthly", header: "Monthly" },
            { key: "annual", header: "Annual" },
          ],
        });
        return;
      }

      // Table / human-readable output
      const title = result.current
        ? "SKU change simulation"
        : "Add-product simulation";

      process.stdout.write(`\n  ${chalk.bold(company.name)} — ${title}\n\n`);

      // Compute label width to align the columns.
      const labelWidth = result.current ? 10 : 10; // "Current:" / "Proposed:" / "Delta:"

      const renderLeg = (
        label: string,
        leg: { productName: string; quantity: number; monthly: number; annual: number; billingTerm: string },
      ): string => {
        const left = `${label.padEnd(labelWidth)}${leg.productName} × ${leg.quantity}`;
        const monthlyStr = `${formatCurrency(leg.monthly, displayCurrency)}/mo`;
        const annualStr = `${formatCurrency(leg.annual, displayCurrency)}/yr`;
        return `  ${left.padEnd(56)}  ${chalk.cyan(monthlyStr.padEnd(14))} ${chalk.cyan(annualStr)}`;
      };

      if (result.current) {
        process.stdout.write(renderLeg("Current:", result.current) + "\n");
      }
      process.stdout.write(renderLeg("Proposed:", result.proposed) + "\n");

      // Delta line — render with the existing subscription's currency so a
      // EUR sub's "Delta:" line shows €, not $ (#472).
      const dMonthly = `${deltaSign(result.delta.monthly)}${formatCurrency(result.delta.monthly, displayCurrency)}/mo`;
      const dAnnual = `${deltaSign(result.delta.annual)}${formatCurrency(result.delta.annual, displayCurrency)}/yr`;
      const dPerSeat = `${deltaSign(result.delta.perSeat)}${formatCurrency(result.delta.perSeat, displayCurrency)}/seat/mo`;
      const deltaColor = result.delta.monthly >= 0 ? chalk.green : chalk.yellow;
      process.stdout.write(
        `  ${"Delta:".padEnd(labelWidth)}` +
          `${deltaColor.bold(dMonthly)}  ${deltaColor(dAnnual)}  ${chalk.dim("(" + dPerSeat + ")")}\n`,
      );

      // Notes
      if (result.notes.length > 0) {
        process.stdout.write("\n");
        for (const n of result.notes) {
          process.stdout.write(chalk.dim(`  • ${n}\n`));
        }
      }

      // Pickable next steps. Place the change as an order is the headline
      // action; viewing the affected subscription (if one exists) is the
      // natural verification step.
      const steps: NextStep[] = [
        {
          key: "1",
          label: `${chalk.cyan(
            replCmd(
              `pax8 orders create --company "${company.name}" --product "${proposedProduct.name}" --quantity ${proposedQuantity} --billing-term ${result.proposed.billingTerm}`,
            ),
          )}  ${chalk.dim("place this change")}`,
          command: [
            "orders",
            "create",
            "--company",
            company.name,
            "--product",
            proposedProduct.name,
            "--quantity",
            String(proposedQuantity),
            "--billing-term",
            result.proposed.billingTerm,
          ],
        },
      ];
      let nKey = 2;
      if (affectedSubscriptionId) {
        steps.push({
          key: String(nKey++),
          label: `${chalk.cyan(replCmd(`pax8 subscriptions show ${affectedSubscriptionId}`))}  ${chalk.dim("inspect the affected subscription")}`,
          command: ["subscriptions", "show", affectedSubscriptionId],
        });
      }
      steps.push({
        key: String(nKey++),
        label: `${chalk.cyan(replCmd(`pax8 clients more "${company.name}"`))}  ${chalk.dim("view client")}`,
        command: ["clients", "more", company.name],
      });
      process.stderr.write("\n");
      process.stderr.write(chalk.dim("  Try next:\n"));
      await promptNextSteps(steps, { renderList: true });
    } catch (error) {
      spinner.stop();
      handleCommandError(error, undefined, "Cost simulation failed");
    }
  });
