import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError, extractErrorDetail } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirmWithChange, replCmd } from "../../lib/confirm.js";
import { formatStatus, formatDate, formatCurrency, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { ApiError, getTelemetry } from "@pax8/core";
import type { CreateOrderInput, OrderLineItemInput, BillingTerm, CommitmentTerm } from "@pax8/core";
import { resolveCompany } from "../../lib/resolve-company.js";
import { resolveProduct } from "../../lib/resolve-product.js";

export const ordersCreateCommand = new Command("create")
  .description("Create a new order")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .requiredOption("--product <id|name>", "Product ID or name (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option("--commitment-term <term>", "Commitment term (Monthly, 1-Year, or 3-Year)")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders create --company a1b2c3d4-e5f6-7890-abcd-ef1234567890 --product prod-m365-biz-prem-0001 --quantity 5
  pax8 orders create --company a1b2c3d4 --product prod-123 --quantity 10 --billing-term Annual
  pax8 orders create --company a1b2c3d4 --product prod-123 --yes`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    // Hoist names so they're available in catch block for error messages
    let productName: string = allOpts.product;
    let companyName: string = allOpts.company;

    try {
      const ctx = await buildContext(allOpts);
      const quantity = parseInt(allOpts.quantity, 10);

      if (isNaN(quantity) || quantity <= 0) {
        throw new CliError(
          `Invalid quantity: "${allOpts.quantity}"`,
          ["Quantity must be a positive integer (1 or greater)"],
          [`Example: ${replCmd("pax8 orders create")} --company <id> --product <id> --quantity 5`],
        );
      }

      // Resolve names, pricing, and pre-check orderability
      let commitmentTerm = allOpts.commitmentTerm;
      let unitPrice: number | null = null;
      let requiresCommitment = false;
      let productNotFound = false;
      const warnings: string[] = [];

      // Resolve company (hard requirement — will throw on failure)
      const companyResult = await resolveCompany(ctx, allOpts.company);
      companyName = companyResult.name;
      const resolvedCompanyId = companyResult.id;

      // Resolve product (best effort — warn but continue if not found)
      let resolvedProductId = allOpts.product;
      const productResult = await resolveProduct(ctx, allOpts.product).catch(() => { productNotFound = true; return null; });
      if (productResult) { productName = productResult.name; resolvedProductId = productResult.id; }

      try {
        const pricing = await ctx.api.products.getPricing(resolvedProductId).catch(() => null);

        if (pricing && pricing.length > 0) {
          // Infer commitment requirement: if every pricing plan has a commitmentTerm, the product requires one
          if (pricing.every((p) => p.commitmentTerm)) requiresCommitment = true;
          // Find matching plan — prefer billing term + commitment
          let match = pricing.find((p) => p.billingTerm === allOpts.billingTerm && p.commitmentTerm);
          if (!match) match = pricing.find((p) => p.billingTerm === allOpts.billingTerm);
          if (match) {
            if (!commitmentTerm && match.commitmentTerm) commitmentTerm = match.commitmentTerm;
            const ratePrice = match.rates?.[0]?.suggestedRetailPrice
              ?? (match as Record<string, unknown>).suggestedRetailPrice as number | undefined;
            if (ratePrice) unitPrice = ratePrice;
          } else {
            // No plan matches the billing term
            const available = [...new Set(pricing.map((p) => p.billingTerm))].join(", ");
            warnings.push(`No ${allOpts.billingTerm} pricing found. Available: ${available}`);
          }
        }
      } catch (err) {
        if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] order pre-check failed: ${err}\n`);
      }

      // Pre-flight checks
      if (productNotFound) warnings.push("Product not found in catalog — may not be orderable");
      if (requiresCommitment && !commitmentTerm) {
        warnings.push("Product requires a commitment term — order may fail without one");
      }

      const totalPrice = unitPrice ? unitPrice * quantity : null;
      const mrr = totalPrice
        ? calculateMrr(unitPrice!, quantity, allOpts.billingTerm)
        : null;

      process.stderr.write(chalk.bold("\n  📦 Order Preview:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${productName}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(quantity)}\n`);
      process.stderr.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${allOpts.billingTerm}\n`);
      if (commitmentTerm) {
        process.stderr.write(`  ${chalk.dim("Commitment:".padEnd(18))}${commitmentTerm}\n`);
      }
      if (unitPrice) {
        process.stderr.write(`  ${chalk.dim("Unit Price:".padEnd(18))}${formatCurrency(unitPrice)}/seat/${allOpts.billingTerm === "Annual" ? "yr" : "mo"}\n`);
      }
      if (totalPrice) {
        process.stderr.write(`\n  ${chalk.dim("Total:".padEnd(18))}${chalk.bold(formatCurrency(totalPrice))}/${allOpts.billingTerm === "Annual" ? "yr" : "mo"}\n`);
      }
      if (mrr) {
        process.stderr.write(`  ${chalk.dim("MRR Impact:".padEnd(18))}${chalk.green.bold("+" + formatCurrency(mrr) + "/mo")}\n`);
      }

      // Show warnings
      if (warnings.length > 0) {
        process.stderr.write("\n");
        for (const w of warnings) {
          process.stderr.write(chalk.yellow(`  ⚠ ${w}\n`));
        }
      }

      process.stderr.write("\n");

      const confirmedQty = await confirmWithChange(
        `Place order for ${formatQuantity(quantity)}?`,
        quantity,
      );
      if (confirmedQty === null) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating order...").start();

      // Only pass fields defined in OrderLineItemInput — do not include
      // display-only fields like productName which are not part of the API input schema.
      const lineItem: OrderLineItemInput = {
        productId: resolvedProductId,
        quantity: confirmedQty,
        billingTerm: allOpts.billingTerm as BillingTerm,
        ...(commitmentTerm ? { commitmentTerm: commitmentTerm as CommitmentTerm } : {}),
      };

      const orderInput: CreateOrderInput = {
        companyId: resolvedCompanyId,
        lineItems: [lineItem],
      };
      const order = await ctx.api.orders.create(orderInput);
      await invalidateCacheAfterWrite();

      spinner.succeed("Order created 🎉");

      // Track revenue
      try {
        const tel = getTelemetry();
        const orderMrr = unitPrice ? calculateMrr(unitPrice, confirmedQty, allOpts.billingTerm) : undefined;
        tel.track({
          event: "command_executed",
          command: "orders.create",
          flags: [],
          duration_ms: 0,
          success: true,
          cli_version: "0.1.0",
          node_version: process.version,
          os: process.platform,
          demo_mode: process.env.PAX8_DEMO === "1",
          order_success: true,
          order_total_dollars: unitPrice ? unitPrice * confirmedQty : undefined,
          order_mrr_impact: orderMrr ?? undefined,
          order_seats: confirmedQty,
        });
      } catch { /* telemetry never breaks the CLI */ }

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      // Post-order summary with financial impact
      const finalMrr = unitPrice ? calculateMrr(unitPrice, confirmedQty, allOpts.billingTerm) : null;
      const finalTotal = unitPrice ? unitPrice * confirmedQty : null;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${productName}\n`);
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
      process.stdout.write(`  ${chalk.dim("Seats:".padEnd(18))}${formatQuantity(confirmedQty)}\n`);
      if (unitPrice) {
        process.stdout.write(`  ${chalk.dim("Unit Price:".padEnd(18))}${formatCurrency(unitPrice)}/seat/${allOpts.billingTerm === "Annual" ? "yr" : "mo"}\n`);
      }
      if (finalTotal) {
        process.stdout.write(`  ${chalk.dim("Total:".padEnd(18))}${formatCurrency(finalTotal)}/${allOpts.billingTerm === "Annual" ? "yr" : "mo"}\n`);
      }
      if (finalMrr) {
        process.stdout.write(`  ${chalk.dim("Est. MRR:".padEnd(18))}${chalk.green.bold("+" + formatCurrency(finalMrr) + "/mo")} (${chalk.green("+" + formatCurrency(finalMrr * 12) + "/yr")})\n`);
      }
      process.stdout.write("\n");
      // Next steps
      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders show ${order.id}`))}  ${chalk.dim("check order status")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 subscriptions list --company "${companyName}"`))}  ${chalk.dim("view subscriptions")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      // Provide order-specific error messages with actionable guidance
      if (error instanceof ApiError) {
        const displayProduct = productName || allOpts.product;
        const displayCompany = companyName || allOpts.company;

        if (error.statusCode === 404) {
          // Extract a short searchable name from the full product name
          const shortName = displayProduct.replace(/\s*\[.*?\]\s*/g, "").replace(/\s*\(.*?\)\s*/g, "").trim().split(" ").slice(0, 4).join(" ");
          handleCommandError(
            new CliError(
              `"${displayProduct}" can't be ordered for ${displayCompany}`,
              [
                "This product may not be available in your region, or it may be restricted (e.g., non-profit only)",
              ],
              [
                `Search for alternatives: ${replCmd("pax8 products search")} "${shortName}"`,
                `View ${displayCompany}'s current subscriptions: ${replCmd("pax8 companies more")} "${displayCompany}"`,
              ],
            ),
          );
        }

        if (error.statusCode === 422) {
          const detail = extractErrorDetail(error.responseBody);
          const causes: string[] = [];
          if (detail) causes.push(detail);

          const steps: string[] = [];
          if (detail?.includes("requires commitment")) {
            causes.push("This product requires a Microsoft tenant commitment that may need to be set up in the Pax8 portal");
            steps.push("Try adding --commitment-term 1-Year or --commitment-term Monthly");
            steps.push("If that fails, provision the subscription through the Pax8 portal instead");
          } else {
            causes.push("Order validation failed — check quantity, billing term, or provisioning requirements");
            steps.push("Ensure the quantity meets minimum/maximum seat requirements");
          }
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product}`);

          handleCommandError(
            new CliError(
              `Can't order "${displayProduct}" for ${displayCompany}`,
              causes,
              steps,
            ),
          );
        }

        if (error.statusCode === 400) {
          const detail = extractErrorDetail(error.responseBody);
          const causes: string[] = [];
          const steps: string[] = [];

          if (detail?.includes("commitmentTerm")) {
            causes.push("This product doesn't support the commitment term format sent via API");
            causes.push("New Commerce Experience (NCE) products may require provisioning through the Pax8 portal");
            steps.push("Try placing this order in the Pax8 Marketplace portal instead");
          } else {
            causes.push("The Pax8 API rejected the order request");
            if (detail) causes.push(detail);
            steps.push("Double-check all order parameters (product ID, company ID, quantity)");
          }
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product}`);

          handleCommandError(
            new CliError(`Can't order "${displayProduct}" for ${displayCompany}`, causes, steps),
          );
        }
      }

      handleCommandError(error, undefined, "Failed to create order");
    }
  });
