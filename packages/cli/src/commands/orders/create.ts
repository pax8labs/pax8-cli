import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirm, isReplMode } from "../../lib/confirm.js";
import { formatStatus, formatDate, formatCurrency } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { ApiError } from "@pax8/core";
import type { CreateOrderInput } from "@pax8/core";

/**
 * Extract a human-readable detail string from an API error response body.
 */
function extractApiDetail(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const b = body as Record<string, unknown>;
  for (const key of ["message", "error", "detail", "error_description"]) {
    if (typeof b[key] === "string" && b[key]) return b[key] as string;
  }
  if (typeof b.error === "object" && b.error !== null) {
    const inner = b.error as Record<string, unknown>;
    if (typeof inner.message === "string") return inner.message;
  }
  return undefined;
}

export const ordersCreateCommand = new Command("create")
  .description("Create a new order")
  .requiredOption("--company <id>", "Company ID (required)")
  .requiredOption("--product <id>", "Product ID (required)")
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

      // Resolve names and pricing for a human-friendly preview
      let commitmentTerm = allOpts.commitmentTerm;
      let unitPrice: number | null = null;
      try {
        const [company, product, pricing] = await Promise.all([
          ctx.api.companies.get(allOpts.company).catch(() => null),
          ctx.api.products.get(allOpts.product).catch(() => null),
          ctx.api.products.getPricing(allOpts.product).catch(() => null),
        ]);
        if (company?.name) companyName = company.name;
        if (product?.name) productName = product.name;

        // Find matching pricing plan — prefer plans WITH a commitment term
        if (pricing && pricing.length > 0) {
          // First try: match billing term + has commitment (most orderable)
          let match = pricing.find((p) => p.billingTerm === allOpts.billingTerm && p.commitmentTerm);
          // Fallback: match billing term only
          if (!match) match = pricing.find((p) => p.billingTerm === allOpts.billingTerm);
          if (match) {
            if (!commitmentTerm && match.commitmentTerm) commitmentTerm = match.commitmentTerm;
            if (match.rates?.[0]?.suggestedRetailPrice) {
              unitPrice = match.rates[0].suggestedRetailPrice;
            }
          }
        }
      } catch { /* best effort */ }

      const totalPrice = unitPrice ? unitPrice * quantity : null;
      const mrr = totalPrice
        ? allOpts.billingTerm === "Annual" ? totalPrice / 12 : totalPrice
        : null;

      process.stderr.write(chalk.bold("\n  📦 Order Preview:\n\n"));
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
      process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${productName}\n`);
      process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${quantity} seats\n`);
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
      process.stderr.write("\n");

      if (isReplMode() && !allOpts.yes) {
        // Can't prompt in REPL — show the command to run with --yes
        const cmd = `orders create --company ${allOpts.company} --product ${allOpts.product} --quantity ${quantity}${commitmentTerm && commitmentTerm !== "Monthly" ? ` --commitment-term ${commitmentTerm}` : ""} --yes`;
        process.stderr.write(chalk.dim("  To confirm, run:\n"));
        process.stderr.write(`  ${chalk.cyan(cmd)}\n\n`);
        return;
      }

      const confirmed = await confirm("Place this order?", { default: true });
      if (!confirmed) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Creating order...").start();

      // Only pass fields defined in OrderLineItemInput — do not include
      // display-only fields like productName which are not part of the API input schema.
      const lineItem: Record<string, unknown> = {
        productId: allOpts.product,
        quantity,
        billingTerm: allOpts.billingTerm,
      };
      // Only pass commitment term if it's a real commitment (not "Monthly" which is the default)
      if (commitmentTerm && commitmentTerm !== "Monthly") {
        lineItem.commitmentTerm = commitmentTerm;
      }

      const orderInput: CreateOrderInput = {
        companyId: allOpts.company,
        lineItems: [lineItem as any],
      };
      const order = await ctx.api.orders.create(orderInput);
      await invalidateCacheAfterWrite();

      spinner.succeed("Order created 🎉");

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(order, null, 2) + "\n");
        return;
      }

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Date:".padEnd(18))}${formatDate(order.createdDate)}\n`);
      if (order.lineItems && order.lineItems.length > 0) {
        process.stdout.write(`  ${chalk.dim("Items:".padEnd(18))}${order.lineItems.length}\n`);
      }
      // Next steps
      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(`pax8 orders show ${order.id}`)}  ${chalk.dim("check order status")}\n`);
      process.stderr.write(`    ${chalk.cyan(`pax8 subscriptions list --company ${allOpts.company}`)}  ${chalk.dim("view subscriptions")}\n`);
      process.stderr.write("\n");
    } catch (error) {
      // Provide order-specific error messages with actionable guidance
      if (error instanceof ApiError) {
        const product = productName || allOpts.product;
        const company = companyName || allOpts.company;

        if (error.statusCode === 404) {
          // Extract a short searchable name from the full product name
          const shortName = product.replace(/\s*\[.*?\]\s*/g, "").replace(/\s*\(.*?\)\s*/g, "").trim().split(" ").slice(0, 4).join(" ");
          handleCommandError(
            new CliError(
              `"${product}" can't be ordered for ${company}`,
              [
                "This product may not be available in your region, or it may be restricted (e.g., non-profit only)",
              ],
              [
                `Search for alternatives: pax8 products search "${shortName}"`,
                `View ${company}'s current subscriptions: pax8 companies more ${allOpts.company}`,
              ],
            ),
          );
        }

        if (error.statusCode === 422) {
          const detail = extractApiDetail(error.responseBody);
          const causes = [
            "Order validation failed -- check quantity, billing term, or provisioning requirements",
          ];
          if (detail) causes.push(`API detail: ${detail}`);

          handleCommandError(
            new CliError(
              `Failed to create order for "${product}" under "${company}"`,
              causes,
              [
                `Check available billing terms: pax8 products pricing ${allOpts.product}`,
                "Ensure the quantity meets minimum/maximum seat requirements",
                "Verify any required provisioning details for this product",
              ],
            ),
          );
        }

        if (error.statusCode === 400) {
          const detail = extractApiDetail(error.responseBody);
          const causes = ["The Pax8 API rejected the order request"];
          if (detail) causes.push(`API detail: ${detail}`);

          handleCommandError(
            new CliError(
              `Failed to create order for "${product}" under "${company}"`,
              causes,
              [
                "Double-check all order parameters (product ID, company ID, quantity)",
                `View product details: pax8 products show ${allOpts.product}`,
              ],
            ),
          );
        }
      }

      handleCommandError(error, undefined, "Failed to create order");
    }
  });
