import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError, extractErrorDetail } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { confirmWithChange, replCmd } from "../../lib/confirm.js";
import { formatStatus, formatDate, formatCurrency, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import {
  ApiError,
  ERROR_API_VALIDATION,
  ERROR_INVALID_INPUT,
  ERROR_PRODUCT_NOT_FOUND,
  getTelemetry,
} from "@pax8/core";
import type { CreateOrderInput, OrderLineItemInput, BillingTerm } from "@pax8/core";
import { resolveCompany } from "../../lib/resolve-company.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { hashArgs, isValidKey, loadEntry, saveEntry } from "../../lib/idempotency.js";

export const ordersCreateCommand = new Command("create")
  .description("Create a new order")
  .requiredOption("--company <id|name>", "Company ID or name (required)")
  .requiredOption("--product <id|name>", "Product ID or name (required)")
  .option("--quantity <number>", "Quantity", "1")
  .option("--billing-term <term>", "Billing term (Monthly or Annual)", "Monthly")
  .option("--commitment-term <term>", "Commitment term (Monthly, 1-Year, or 3-Year) — auto-resolves to UUID from existing subscription")
  .option("--commitment-term-id <uuid>", "Commitment term UUID (from subscription commitment.id)")
  .option("-y, --yes", "Skip confirmation prompt")
  .option(
    "--idempotency-key <uuid>",
    "Replay-safe key for retries (24h TTL). Accepts UUIDs or 8–128 char identifiers (letters, digits, '-', '_', '.')",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders create --company a1b2c3d4-e5f6-7890-abcd-ef1234567890 --product prod-m365-biz-prem-0001 --quantity 5
  pax8 orders create --company a1b2c3d4 --product prod-123 --quantity 10 --billing-term Annual
  pax8 orders create --company a1b2c3d4 --product prod-123 --yes
  pax8 orders create --company a1b2c3d4 --product prod-123 --idempotency-key 9f3b2c1e-...-e1`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    // Hoist names so they're available in catch block for error messages
    let productName: string = allOpts.product;
    let companyName: string = allOpts.company;

    // --- Idempotency handling ---
    // The "args hash" deliberately excludes `yes` (cosmetic) and the key itself,
    // so retrying with the same key under -y or interactive confirm is allowed.
    const idempotencyKey: string | undefined = allOpts.idempotencyKey;
    const commandName = "orders.create";
    let argsHash: string | null = null;
    if (idempotencyKey !== undefined) {
      if (!isValidKey(idempotencyKey)) {
        await handleCommandError(
          new CliError(
            `Invalid idempotency key: "${idempotencyKey}"`,
            [
              "Idempotency keys must be 8–128 characters of letters, digits, '-', '_', or '.'",
              "UUID v4 is recommended.",
            ],
            [
              "Generate one with: uuidgen",
              `Example: ${replCmd("pax8 orders create")} ... --idempotency-key 9f3b2c1e-7d4f-4a8b-9c2d-1e2f3a4b5c6d`,
            ],
          ),
        );
      }
      argsHash = hashArgs({
        company: allOpts.company,
        product: allOpts.product,
        quantity: allOpts.quantity,
        billingTerm: allOpts.billingTerm,
        commitmentTerm: allOpts.commitmentTerm,
        commitmentTermId: allOpts.commitmentTermId,
      });

      try {
        const cached = await loadEntry(commandName, idempotencyKey);
        if (cached) {
          if (cached.argsHash !== argsHash) {
            await handleCommandError(
              new CliError(
                "Idempotency key reused with different arguments — refusing to retry.",
                [
                  `The key "${idempotencyKey}" was previously used for ${cached.command} with a different argument set.`,
                  "Replaying with new arguments would risk a double-write or a misleading 'cached' response.",
                ],
                [
                  "Generate a new idempotency key for the new request.",
                  `Or wait 24h for the old entry to expire (cached at ${cached.createdAt}).`,
                ],
              ),
            );
          }
          process.stderr.write(chalk.dim("  (idempotent replay)\n"));
          if (cached.output) process.stdout.write(cached.output);
          process.exit(cached.exitCode);
          return;
        }
      } catch (err) {
        // Re-throw CliError thrown via handleCommandError; for other read errors,
        // log in debug mode and proceed (fail-open: if cache is broken, the user
        // still gets to make the call).
        if (err instanceof CliError) throw err;
        if (process.env.PAX8_DEBUG) {
          process.stderr.write(`[debug] idempotency cache read failed: ${err}\n`);
        }
      }
    }

    // Capture stdout so we can replay it on a future invocation with the
    // same idempotency key. We only install the proxy when a key is present.
    let captured = "";
    let succeeded = false;
    const realStdoutWrite = process.stdout.write.bind(process.stdout);
    if (idempotencyKey) {
      // Cast to satisfy the multi-overload signature of process.stdout.write.
      (process.stdout.write as unknown as (chunk: string | Uint8Array) => boolean) = (
        chunk: string | Uint8Array,
      ): boolean => {
        const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        captured += text;
        return realStdoutWrite(chunk as string);
      };
    }
    const restoreStdout = (): void => {
      if (idempotencyKey) {
        process.stdout.write = realStdoutWrite as typeof process.stdout.write;
      }
    };
    const persistEntry = async (): Promise<void> => {
      if (!idempotencyKey || !succeeded || argsHash === null) return;
      try {
        await saveEntry({
          key: idempotencyKey,
          command: commandName,
          argsHash,
          output: captured,
          exitCode: 0,
          createdAt: new Date().toISOString(),
        });
      } catch (err) {
        if (process.env.PAX8_DEBUG) {
          process.stderr.write(`[debug] idempotency cache write failed: ${err}\n`);
        }
      }
    };

    try {
      const ctx = await buildContext(allOpts);
      const quantity = parseInt(allOpts.quantity, 10);

      if (isNaN(quantity) || quantity <= 0) {
        throw new CliError(
          `Invalid quantity: "${allOpts.quantity}"`,
          ["Quantity must be a positive integer (1 or greater)"],
          [`Example: ${replCmd("pax8 orders create")} --company <id> --product <id> --quantity 5`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // Resolve names, pricing, and pre-check orderability
      let commitmentTerm = allOpts.commitmentTerm;
      let commitmentTermId: string | undefined = allOpts.commitmentTermId;
      let unitPrice: number | null = null;
      let requiresCommitment = false;
      let productNotFound = false;
      const warnings: string[] = [];

      // Resolve company (hard requirement — will throw on failure)
      const companyResult = await resolveCompany(ctx, allOpts.company);
      companyName = companyResult.name;
      const resolvedCompanyId = companyResult.id;

      // Resolve product — required for order creation
      let resolvedProductId = allOpts.product;
      const productResult = await resolveProduct(ctx, allOpts.product).catch(() => { productNotFound = true; return null; });
      if (productResult) {
        productName = productResult.name;
        resolvedProductId = productResult.id;
      } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(allOpts.product)) {
        // Input isn't a UUID and couldn't be resolved — can't proceed
        throw new CliError(
          `Product not found: "${allOpts.product}"`,
          ["Could not resolve product name to a product ID"],
          [
            `Search the catalog: ${replCmd("pax8 products search")} "${allOpts.product}"`,
            `Then use the product ID: ${replCmd("pax8 orders create")} --product <product-id> ...`,
          ],
          undefined,
          ERROR_PRODUCT_NOT_FOUND,
        );
      }

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

      // Resolve commitmentTermId from existing subscription for the SAME product.
      // commitmentTermId UUIDs are product-specific and cannot be reused across products.
      if (!commitmentTermId && (commitmentTerm || requiresCommitment)) {
        try {
          const subs = await ctx.api.subscriptions.list({
            companyId: resolvedCompanyId,
            status: "Active",
          });
          // Only match subscriptions for the same product
          const matches = subs.content.filter((s) =>
            s.productId === resolvedProductId && s.commitment?.id
          );
          // Prefer matching commitment term label if specified
          const match = (commitmentTerm
            ? matches.find((s) => s.commitment?.term === commitmentTerm)
            : null
          ) ?? matches[0];
          if (match?.commitment?.id) {
            commitmentTermId = match.commitment.id;
            if (!commitmentTerm) commitmentTerm = match.commitment.term;
            if (process.env.PAX8_DEBUG) {
              process.stderr.write(`[debug] resolved commitmentTermId=${commitmentTermId} from subscription ${match.id}\n`);
            }
          }
        } catch (err) {
          if (process.env.PAX8_DEBUG) process.stderr.write(`[debug] subscription lookup for commitmentTermId failed: ${err}\n`);
        }
      }

      // Pre-flight checks
      if (productNotFound) warnings.push("Product not found in catalog — may not be orderable");
      if (requiresCommitment && !commitmentTermId) {
        warnings.push("Product requires a commitment term but no commitmentTermId could be resolved — order may fail. Use --commitment-term-id <uuid> to provide one directly.");
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
        ...(commitmentTermId ? { commitmentTermId } : {}),
      };

      const orderInput: CreateOrderInput = {
        companyId: resolvedCompanyId,
        lineItems: [lineItem],
      };
      // TODO: When the Pax8 API adds support for an `Idempotency-Key` request
      // header on POST /orders (not currently documented in the existing
      // `OrdersApi.create` shape — see packages/core/src/api/orders.ts), pass
      // `idempotencyKey` through here so the server dedupes natively. Until
      // then, deduplication is purely local via the file cache below.
      const doneWrite = markWriteInFlight("orders");
      let order;
      try {
        order = await ctx.api.orders.create(orderInput);
      } finally {
        doneWrite();
      }
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
        const jsonMrr = unitPrice ? calculateMrr(unitPrice, confirmedQty, allOpts.billingTerm) : null;
        const monthlyCost = jsonMrr; // MRR is by definition the monthly cost
        const annualCost = jsonMrr ? Number((jsonMrr * 12).toFixed(2)) : null;
        const enriched = {
          ...order,
          unitPrice: unitPrice ?? null,
          monthlyCost: monthlyCost ?? null,
          annualCost: annualCost ?? null,
        };
        process.stdout.write(JSON.stringify(enriched, null, 2) + "\n");
        succeeded = true;
        await persistEntry();
        restoreStdout();
        return;
      }

      // Post-order summary with financial impact
      const finalMrr = unitPrice ? calculateMrr(unitPrice, confirmedQty, allOpts.billingTerm) : null;
      const finalAnnual = finalMrr ? Number((finalMrr * 12).toFixed(2)) : null;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${productName}\n`);
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
      process.stdout.write(`  ${chalk.dim("Seats:".padEnd(18))}${formatQuantity(confirmedQty)}\n`);
      if (unitPrice) {
        process.stdout.write(`  ${chalk.dim("Unit price:".padEnd(18))}${formatCurrency(unitPrice)}/seat/${allOpts.billingTerm === "Annual" ? "yr" : "mo"}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Unit price:".padEnd(18))}${chalk.dim("—")}\n`);
      }
      if (finalMrr) {
        process.stdout.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.green.bold(formatCurrency(finalMrr) + "/mo")}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.dim("—")}\n`);
      }
      if (finalAnnual) {
        process.stdout.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.green(formatCurrency(finalAnnual) + "/yr")}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.dim("—")}\n`);
      }
      process.stdout.write("\n");
      // Next steps
      process.stderr.write(chalk.dim("  Try next:\n"));
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders show ${order.id}`))}  ${chalk.dim("check order status")}\n`);
      process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 subscriptions list --company "${companyName}"`))}  ${chalk.dim("view subscriptions")}\n`);
      process.stderr.write("\n");
      succeeded = true;
      await persistEntry();
      restoreStdout();
    } catch (error) {
      // Restore stdout before delegating to handleCommandError (which prints
      // formatted error to stderr and calls process.exit). We don't persist the
      // idempotency entry on error — the agent can retry.
      restoreStdout();
      // Provide order-specific error messages with actionable guidance
      if (error instanceof ApiError) {
        const displayProduct = productName || allOpts.product;
        const displayCompany = companyName || allOpts.company;

        if (error.statusCode === 404) {
          // Extract a short searchable name from the full product name
          const shortName = displayProduct.replace(/\s*\[.*?\]\s*/g, "").replace(/\s*\(.*?\)\s*/g, "").trim().split(" ").slice(0, 4).join(" ");
          await handleCommandError(
            new CliError(
              `"${displayProduct}" can't be ordered for ${displayCompany}`,
              [
                "This product may not be available in your region, or it may be restricted (e.g., non-profit only)",
              ],
              [
                `Search for alternatives: ${replCmd("pax8 products search")} "${shortName}"`,
                `View ${displayCompany}'s current subscriptions: ${replCmd("pax8 companies more")} "${displayCompany}"`,
              ],
              undefined,
              ERROR_PRODUCT_NOT_FOUND,
            ),
          );
        }

        if (error.statusCode === 422) {
          const detail = extractErrorDetail(error.responseBody);
          const causes: string[] = [];
          if (detail) causes.push(detail);

          const steps: string[] = [];
          if (detail?.includes("requires commitment") || detail?.includes("commitmentTerm")) {
            causes.push("This product requires a commitment term ID that couldn't be auto-resolved");
            steps.push("If the company has an existing subscription, try: --commitment-term Monthly or --commitment-term 1-Year");
            steps.push("Or provide the UUID directly: --commitment-term-id <uuid> (from subscription commitment.id)");
            steps.push("If no existing subscription, provision the first one through the Pax8 portal");
          } else {
            causes.push("Order validation failed — check quantity, billing term, or provisioning requirements");
            steps.push("Ensure the quantity meets minimum/maximum seat requirements");
          }
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product}`);

          await handleCommandError(
            new CliError(
              `Can't order "${displayProduct}" for ${displayCompany}`,
              causes,
              steps,
              undefined,
              ERROR_API_VALIDATION,
            ),
          );
        }

        if (error.statusCode === 400) {
          const detail = extractErrorDetail(error.responseBody);
          const causes: string[] = [];
          const steps: string[] = [];

          if (detail?.includes("commitmentTerm")) {
            causes.push("Invalid commitmentTermId — the UUID may not match this product or company");
            steps.push("Check the company's existing subscriptions for a valid commitment.id");
            steps.push("Or provide the UUID directly: --commitment-term-id <uuid>");
          } else {
            causes.push("The Pax8 API rejected the order request");
            if (detail) causes.push(detail);
            steps.push("Double-check all order parameters (product ID, company ID, quantity)");
          }
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product}`);

          await handleCommandError(
            new CliError(
              `Can't order "${displayProduct}" for ${displayCompany}`,
              causes,
              steps,
              undefined,
              ERROR_API_VALIDATION,
            ),
          );
        }
      }

      await handleCommandError(error, undefined, "Failed to create order");
    }
  });
