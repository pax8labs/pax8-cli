// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError, extractErrorDetail } from "../../lib/errors.js";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { confirm, confirmWithChange, replCmd } from "../../lib/confirm.js";
import { formatStatus, formatCurrency, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { debugLog } from "../../lib/debug.js";
import {
  ApiError,
  BillingTermSchema,
  ERROR_API_VALIDATION,
  ERROR_INVALID_INPUT,
  ERROR_PRODUCT_NOT_FOUND,
} from "@pax8/core";
import type {
  CreateOrderInput,
  OrderLineItemCreateInput,
  OrderLineItemProvisioningDetail,
  BillingTerm,
} from "@pax8/core";
import { resolveCompany } from "../../lib/resolve-company.js";
import { resolveProduct } from "../../lib/resolve-product.js";
import { resolveCommitmentTermId } from "../../lib/resolve-commitment.js";
import { hashArgs, isValidKey, withIdempotency } from "../../lib/idempotency.js";
import { setTelemetryFields } from "../../lib/telemetry-context.js";
import { validateEnum } from "../../lib/validate.js";

const BILLING_TERM_VALUES = BillingTermSchema.options as readonly BillingTerm[];

// ─── Multi-line parsing ───────────────────────────────────────────────────────
//
// Repeatable `--line-item product=name,quantity=n[,billing-term=Annual]
// [,commitment-term=1-Year][,commitment-term-id=<uuid>]`. Commander's option
// callback is invoked once per occurrence, with the previous accumulator as
// the second arg — that's how we collect multiple values without `.variadic()`
// (which greedily eats subsequent positional args).

interface RawLineItem {
  product: string;
  quantity: number;
  billingTerm?: string;
  commitmentTerm?: string;
  commitmentTermId?: string;
  /**
   * Per-line provisioning details (#332). Matches the public Pax8 OpenAPI
   * spec's `ProvisioningDetail` array shape — `{ key, values: string[] }[]`.
   * Parsed from one or more `provisioning=<key>:<value>[|<value>...]` entries
   * inside a single `--line-item` spec string.
   */
  provisioningDetails?: OrderLineItemProvisioningDetail[];
  /** Original spec string, for error messages. */
  raw: string;
}

function collectLineItem(value: string, prev: RawLineItem[]): RawLineItem[] {
  // We only validate string shape here; product resolution happens in the
  // action handler so we can hit the API in parallel.
  return prev.concat([parseLineItemSpec(value)]);
}

function parseLineItemSpec(spec: string): RawLineItem {
  const pairs = spec.split(",").map((s) => s.trim()).filter(Boolean);
  const out: Partial<RawLineItem> = { raw: spec };
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq < 0) {
      throw new CliError(
        `Invalid --line-item spec: "${spec}"`,
        [`Each comma-separated entry must be key=value (got "${pair}")`],
        [
          `Example: --line-item product=prod-m365-biz-prem-0001,quantity=5`,
          `Multiple lines: --line-item product=p1,quantity=5 --line-item product=p2,quantity=10,billing-term=Annual`,
        ],
        undefined,
        ERROR_INVALID_INPUT,
      );
    }
    const key = pair.slice(0, eq).trim().toLowerCase();
    const val = pair.slice(eq + 1).trim();
    switch (key) {
      case "product":
      case "product-id":
      case "productid":
        out.product = val;
        break;
      case "quantity":
      case "qty": {
        const n = parseInt(val, 10);
        if (isNaN(n) || n <= 0) {
          throw new CliError(
            `Invalid quantity in --line-item "${spec}": "${val}"`,
            ["Quantity must be a positive integer (1 or greater)"],
            [`Example: --line-item product=<id>,quantity=5`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        out.quantity = n;
        break;
      }
      case "billing-term":
      case "billingterm":
        out.billingTerm = val;
        break;
      case "commitment-term":
      case "commitmentterm":
        out.commitmentTerm = val;
        break;
      case "commitment-term-id":
      case "commitmenttermid":
        out.commitmentTermId = val;
        break;
      case "provisioning":
      case "provisioning-detail":
      case "provisioningdetail": {
        // Provisioning details ride the public Pax8 OpenAPI's
        // `ProvisioningDetail[]` shape — `{ key, values: string[] }`. The
        // spec-string syntax is `provisioning=<key>:<value>[|<value>...]`,
        // and the option can be repeated within a single --line-item to
        // accumulate multiple provisioning entries. See #332.
        //
        // Example single-value: provisioning=domain:contoso.com
        // Example multi-value:  provisioning=region:us-east|us-west
        const colon = val.indexOf(":");
        if (colon < 0) {
          throw new CliError(
            `Invalid provisioning entry in --line-item "${spec}": "${val}"`,
            [`Provisioning entries must be provisioning=<key>:<value>[|<value>...] (got "${val}")`],
            [
              `Example: --line-item product=<id>,quantity=5,provisioning=domain:contoso.com`,
              `Multiple values per key: provisioning=region:us-east|us-west`,
              `Multiple keys: ... ,provisioning=domain:contoso.com,provisioning=tier:premium`,
            ],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        const provKey = val.slice(0, colon).trim();
        const provValuesRaw = val.slice(colon + 1).trim();
        if (!provKey) {
          throw new CliError(
            `Invalid provisioning entry in --line-item "${spec}": missing key in "${val}"`,
            [`Provisioning entries must be provisioning=<key>:<value> with a non-empty key`],
            [`Example: --line-item product=<id>,quantity=5,provisioning=domain:contoso.com`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        const values = provValuesRaw
          .split("|")
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
        if (values.length === 0) {
          throw new CliError(
            `Invalid provisioning entry in --line-item "${spec}": missing values for key "${provKey}"`,
            [`Provisioning entries must include at least one value (provisioning=<key>:<value>)`],
            [`Example: --line-item product=<id>,quantity=5,provisioning=${provKey}:somevalue`],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }
        out.provisioningDetails = [
          ...(out.provisioningDetails ?? []),
          { key: provKey, values },
        ];
        break;
      }
      default:
        throw new CliError(
          `Unknown key in --line-item "${spec}": "${key}"`,
          [`Supported keys: product, quantity, billing-term, commitment-term, commitment-term-id, provisioning`],
          [`Example: --line-item product=prod-m365-biz-prem-0001,quantity=5,billing-term=Annual`],
          undefined,
          ERROR_INVALID_INPUT,
        );
    }
  }
  if (!out.product) {
    throw new CliError(
      `Missing product in --line-item "${spec}"`,
      ["Each --line-item must include product=<id|name>"],
      [`Example: --line-item product=prod-m365-biz-prem-0001,quantity=5`],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  if (out.quantity === undefined) {
    throw new CliError(
      `Missing quantity in --line-item "${spec}"`,
      ["Each --line-item must include quantity=<n>"],
      [`Example: --line-item product=${out.product},quantity=5`],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return out as RawLineItem;
}

// ─── Per-line resolution ──────────────────────────────────────────────────────

interface ResolvedLine {
  productId: string;
  productName: string;
  quantity: number;
  billingTerm: string;
  commitmentTerm?: string;
  commitmentTermId?: string;
  /** Per-line provisioning details, spec-shaped (#332). */
  provisioningDetails?: OrderLineItemProvisioningDetail[];
  unitPrice: number | null;
  warnings: string[];
}

/** Resolve a single line item: product → pricing → commitment. */
async function resolveLine(
  ctx: CommandContext,
  companyId: string,
  raw: RawLineItem,
  defaultBillingTerm: string,
): Promise<ResolvedLine> {
  const billingTerm = raw.billingTerm ?? defaultBillingTerm;
  let productId = raw.product;
  let productName = raw.product;
  let productNotFound = false;
  const warnings: string[] = [];

  // Capture resolveProduct's CliError so we can re-surface its top-3
  // "Did you mean" suggestions to the user (#408 / partner-walkthrough
  // finding #8). Pre-#408 we swallowed the error and emitted a generic
  // "Product not found" with only a `products search` hint — the partner
  // round-tripped through `pax8 products search` just to find a typo'd
  // name. The new resolver already ranks the catalog top-3; preserve
  // that richer error here so it makes it to the user.
  let resolveErr: unknown = null;
  const productResult = await resolveProduct(ctx, raw.product).catch((err) => {
    productNotFound = true;
    resolveErr = err;
    return null;
  });
  if (productResult) {
    productId = productResult.id;
    productName = productResult.name;
  } else if (!/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw.product)) {
    // Re-throw the resolver's richer CliError when we have it (carries
    // "Did you mean" suggestions); fall back to the legacy generic shape
    // only if the failure wasn't a CliError (defensive — shouldn't happen).
    if (resolveErr instanceof CliError) throw resolveErr;
    throw new CliError(
      `Product not found: "${raw.product}"`,
      ["Could not resolve product name to a product ID"],
      [
        `Search the catalog: ${replCmd("pax8 products search")} "${raw.product}"`,
        `Then use the product ID in --line-item product=<id>,quantity=<n>`,
      ],
      undefined,
      ERROR_PRODUCT_NOT_FOUND,
    );
  }

  let unitPrice: number | null = null;
  let commitmentTerm = raw.commitmentTerm;
  let commitmentTermId = raw.commitmentTermId;
  let requiresCommitment = false;

  try {
    const pricing = await ctx.api.products.getPricing(productId).catch(() => null);
    if (pricing && pricing.length > 0) {
      if (pricing.every((p) => p.commitmentTerm)) requiresCommitment = true;
      let match = pricing.find((p) => p.billingTerm === billingTerm && p.commitmentTerm);
      if (!match) match = pricing.find((p) => p.billingTerm === billingTerm);
      if (match) {
        if (!commitmentTerm && match.commitmentTerm) commitmentTerm = match.commitmentTerm;
        const ratePrice = match.rates?.[0]?.suggestedRetailPrice
          ?? (match as Record<string, unknown>).suggestedRetailPrice as number | undefined;
        if (ratePrice) unitPrice = ratePrice;
      } else {
        const available = [...new Set(pricing.map((p) => p.billingTerm))].join(", ");
        warnings.push(`No ${billingTerm} pricing for ${productName}. Available: ${available}`);
      }
    }
  } catch (err) {
    debugLog("order pre-check failed", err);
  }

  if (!commitmentTermId && (commitmentTerm || requiresCommitment)) {
    const info = await resolveCommitmentTermId(ctx, companyId, productId, commitmentTerm);
    if (info) {
      commitmentTermId = info.id;
      if (!commitmentTerm) commitmentTerm = info.term;
    }
  }

  if (productNotFound) warnings.push(`${productName}: product not found in catalog — may not be orderable`);

  if (requiresCommitment && !commitmentTermId) {
    // Hard-fail: a missing commitmentTermId for a product that requires one
    // will only ever fail at the API. Surface it pre-flight so the user
    // doesn't confirm a doomed preview (#230).
    //
    // Recovery steps cover both single-line (`--commitment-term ...`) and
    // multi-line (`commitment-term=...` inside --line-item) so the message
    // is useful regardless of which entry point the user is on.
    throw new CliError(
      `Can't order "${productName}"`,
      [
        `Product ${productName} requires a commitment term`,
        "This product requires a commitment term ID that couldn't be auto-resolved",
      ],
      [
        "If the company has an existing subscription, try: --commitment-term Monthly or --commitment-term 1-Year (or commitment-term=<term> inside --line-item)",
        "Or provide the UUID directly: --commitment-term-id <uuid> (from subscription commitment.id)",
        "If no existing subscription, provision the first one through the Pax8 portal",
        `View product details: ${replCmd("pax8 products show")} ${productId}`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }

  return {
    productId,
    productName,
    quantity: raw.quantity,
    billingTerm,
    commitmentTerm,
    commitmentTermId,
    provisioningDetails: raw.provisioningDetails,
    unitPrice,
    warnings,
  };
}

// ─── Command ──────────────────────────────────────────────────────────────────

export const ordersCreateCommand = new Command("create")
  .description("Create a new order")
  .option("--company <id|name>", "Company ID or name (required)")
  .option("--product <id|name>", "Product ID or name (single-line shorthand)")
  .option("--quantity <number>", "Quantity (single-line)", "1")
  .option(
    "--billing-term <term>",
    `Billing term — one of ${BILLING_TERM_VALUES.join(" | ")} (default Monthly)`,
    "Monthly",
  )
  .option("--commitment-term <term>", "Commitment term (Monthly, 1-Year, or 3-Year) — auto-resolves to UUID from existing subscription")
  .option("--commitment-term-id <uuid>", "Commitment term UUID (from subscription commitment.id)")
  .option(
    "--line-item <spec>",
    "Add a line item: product=<id|name>,quantity=<n>[,billing-term=<term>][,commitment-term=<term>][,commitment-term-id=<uuid>][,provisioning=<key>:<value>[|<value>...]]. Repeat for multi-line orders.",
    collectLineItem,
    [] as RawLineItem[],
  )
  .option("--dry-run", "Validate the order without placing it (maps to API isMock=true)")
  .option("-y, --yes", "Skip confirmation prompt")
  .option(
    "--idempotency-key <uuid>",
    "Host-local replay cache key (24h TTL). Same-host re-runs return the cached response. NOTE: not yet sent on the wire — cross-host / cross-process retries are NOT deduped (#474). Accepts UUIDs or 8–128 char identifiers (letters, digits, '-', '_', '.')",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 orders create --company a1b2c3d4-e5f6-7890-abcd-ef1234567890 --product prod-m365-biz-prem-0001 --quantity 5
  pax8 orders create --company a1b2c3d4 --product prod-123 --quantity 10 --billing-term Annual
  pax8 orders create --company "Acme" \\
    --line-item product=prod-m365-biz-prem-0001,quantity=25 \\
    --line-item product=prod-defender-p1,quantity=25,billing-term=Annual
  pax8 orders create --company "Acme" --product prod-123 --quantity 5 --dry-run
  pax8 orders create --company a1b2c3d4 --product prod-123 --idempotency-key 9f3b2c1e-...-e1`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    // Hoist names so they're available in catch block for error messages
    let productName: string = allOpts.product ?? "";
    let companyName: string = allOpts.company ?? "";

    const rawLineItems: RawLineItem[] = (allOpts.lineItem as RawLineItem[]) ?? [];

    // Fail-fast enum validation BEFORE any IO (#408). The single-line
    // `--billing-term` lands on `allOpts.billingTerm`; each `--line-item`
    // spec can also carry its own `billing-term=` clause and the parser
    // surfaces it on `RawLineItem.billingTerm`. Validate both so a typo'd
    // value like `--billing-term annual` (lowercased) fails before
    // resolveCompany / resolveProduct ever fires.
    try {
      validateEnum(allOpts.billingTerm, BILLING_TERM_VALUES, "--billing-term", {
        cmdHint: "pax8 orders create",
      });
      for (const li of rawLineItems) {
        validateEnum(li.billingTerm, BILLING_TERM_VALUES, "--line-item billing-term", {
          cmdHint: "pax8 orders create",
        });
      }
    } catch (error) {
      await handleCommandError(error);
    }
    const dryRun: boolean = !!allOpts.dryRun;

    // ── Mode detection: single-line shorthand vs multi-line ──
    //
    // Backward compat: `--product` (with optional --quantity/--billing-term/
    // --commitment-term) is the original single-line entry point. It MUST
    // continue to work identically when --line-item is not used.
    //
    // We forbid mixing the two — merging them would be ambiguous (does
    // --quantity apply to the --product line or all --line-items?). Better
    // to fail fast and tell the user to pick one.
    const hasSingleLine = !!allOpts.product;
    const hasMultiLine = rawLineItems.length > 0;

    if (!allOpts.company) {
      await handleCommandError(
        new CliError(
          "Missing required option: --company",
          ["--company <id|name> is required for orders create"],
          [
            `Example: ${replCmd("pax8 orders create")} --company "Acme" --product prod-123 --quantity 5`,
            `List clients: ${replCmd("pax8 clients list")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        ),
      );
    }

    if (hasSingleLine && hasMultiLine) {
      await handleCommandError(
        new CliError(
          "Cannot mix --product and --line-item",
          [
            "--product/--quantity is the single-line shorthand and --line-item is the multi-line form",
            "Pass one or the other, not both",
          ],
          [
            `Single line: ${replCmd("pax8 orders create")} --company "Acme" --product prod-123 --quantity 5`,
            `Multi-line:  ${replCmd("pax8 orders create")} --company "Acme" --line-item product=prod-1,quantity=5 --line-item product=prod-2,quantity=10`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        ),
      );
    }

    if (!hasSingleLine && !hasMultiLine) {
      await handleCommandError(
        new CliError(
          "Missing line item: pass --product or --line-item",
          [
            "An order needs at least one line item",
          ],
          [
            `Single line: ${replCmd("pax8 orders create")} --company "Acme" --product prod-123 --quantity 5`,
            `Multi-line:  ${replCmd("pax8 orders create")} --company "Acme" --line-item product=prod-1,quantity=5 --line-item product=prod-2,quantity=10`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        ),
      );
    }

    // --- Idempotency handling ---
    // The "args hash" deliberately excludes `yes` (cosmetic) and the key itself,
    // so retrying with the same key under -y or interactive confirm is allowed.
    // It DOES include `dryRun` and the line-item array so a real submit and a
    // dry-run with the same key are distinct cache entries.
    const idempotencyKey: string | undefined = allOpts.idempotencyKey;
    if (idempotencyKey !== undefined && !isValidKey(idempotencyKey)) {
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

    // Build a stable normalized "lines" array for the args hash so multi-line
    // orders cache deterministically. For single-line we pass the same shape
    // (one entry) so single→multi refactors don't accidentally invalidate
    // an in-flight idempotent retry.
    const hashLines = hasMultiLine
      ? rawLineItems.map((l) => ({
          product: l.product,
          quantity: l.quantity,
          billingTerm: l.billingTerm,
          commitmentTerm: l.commitmentTerm,
          commitmentTermId: l.commitmentTermId,
          provisioningDetails: l.provisioningDetails,
        }))
      : [{
          product: allOpts.product,
          quantity: allOpts.quantity,
          billingTerm: allOpts.billingTerm,
          commitmentTerm: allOpts.commitmentTerm,
          commitmentTermId: allOpts.commitmentTermId,
        }];

    const argsHash = hashArgs({
      company: allOpts.company,
      lines: hashLines,
      dryRun,
    });

    try {
      await withIdempotency<boolean>(
        {
          commandName: "orders.create",
          idempotencyKey,
          argsHash,
          // Don't cache "user cancelled at confirm" as a successful run.
          shouldPersist: (didWrite) => didWrite,
        },
        async (): Promise<boolean> => {
      const ctx = await buildContext(allOpts);

      // ── Resolve company (hard requirement — will throw on failure) ──
      const companyResult = await resolveCompany(ctx, allOpts.company);
      companyName = companyResult.name;
      const resolvedCompanyId = companyResult.id;

      // ── Build the working set of raw line items ──
      let workingLines: RawLineItem[];
      if (hasMultiLine) {
        workingLines = rawLineItems;
      } else {
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
        workingLines = [{
          product: allOpts.product,
          quantity,
          billingTerm: allOpts.billingTerm,
          commitmentTerm: allOpts.commitmentTerm,
          commitmentTermId: allOpts.commitmentTermId,
          raw: `product=${allOpts.product},quantity=${quantity}`,
        }];
      }

      // ── Resolve every line in parallel (product → pricing → commitment) ──
      // resolveLine throws CliError on hard failures (product-not-found,
      // commitment-required-but-unresolvable). Promise.all surfaces the
      // first; the catch block below routes it through handleCommandError.
      const resolvedLines = await Promise.all(
        workingLines.map((l) =>
          resolveLine(ctx, resolvedCompanyId, l, allOpts.billingTerm),
        ),
      );

      // For backward-compat error messages: when single-line, set the hoisted
      // productName to the resolved name.
      if (!hasMultiLine && resolvedLines[0]) {
        productName = resolvedLines[0].productName;
      }

      // ── Preview ──
      const isMulti = resolvedLines.length > 1;
      const banner = dryRun
        ? chalk.yellow.bold("\n  📦 DRY RUN — Order Preview (no order will be placed):\n\n")
        : chalk.bold("\n  📦 Order Preview:\n\n");
      process.stderr.write(banner);
      process.stderr.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);
      if (!isMulti) {
        const line = resolvedLines[0];
        process.stderr.write(`  ${chalk.dim("Product:".padEnd(18))}${line.productName}\n`);
        process.stderr.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(line.quantity)}\n`);
        process.stderr.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${line.billingTerm}\n`);
        if (line.commitmentTerm) {
          process.stderr.write(`  ${chalk.dim("Commitment:".padEnd(18))}${line.commitmentTerm}\n`);
        }
        if (line.unitPrice) {
          process.stderr.write(`  ${chalk.dim("Unit Price:".padEnd(18))}${formatCurrency(line.unitPrice)}/seat/${line.billingTerm === "Annual" ? "yr" : "mo"}\n`);
        }
      } else {
        process.stderr.write(`  ${chalk.dim("Line Items:".padEnd(18))}${resolvedLines.length}\n\n`);
        resolvedLines.forEach((line, idx) => {
          process.stderr.write(`  ${chalk.dim(`#${idx + 1}`.padEnd(4))}${chalk.bold(line.productName)}\n`);
          process.stderr.write(`        ${chalk.dim("Quantity:".padEnd(14))}${formatQuantity(line.quantity)}\n`);
          process.stderr.write(`        ${chalk.dim("Billing:".padEnd(14))}${line.billingTerm}\n`);
          if (line.commitmentTerm) {
            process.stderr.write(`        ${chalk.dim("Commitment:".padEnd(14))}${line.commitmentTerm}\n`);
          }
          if (line.unitPrice) {
            const unitPer = line.billingTerm === "Annual" ? "yr" : "mo";
            const lineTotal = line.unitPrice * line.quantity;
            process.stderr.write(`        ${chalk.dim("Unit Price:".padEnd(14))}${formatCurrency(line.unitPrice)}/seat/${unitPer}\n`);
            process.stderr.write(`        ${chalk.dim("Subtotal:".padEnd(14))}${formatCurrency(lineTotal)}/${unitPer}\n`);
          }
          if (idx < resolvedLines.length - 1) process.stderr.write("\n");
        });
      }

      // ── Totals (sum across lines, normalized to monthly Pax8 cost) ──
      const totalMonthly = resolvedLines.reduce((acc, l) => {
        if (!l.unitPrice) return acc;
        return acc + calculateMrr(l.unitPrice, l.quantity, l.billingTerm);
      }, 0);
      const allPriced = resolvedLines.every((l) => l.unitPrice !== null);
      if (allPriced && totalMonthly > 0) {
        process.stderr.write(`\n  ${chalk.dim("Pax8 Cost Impact:".padEnd(20))}${chalk.green.bold("+" + formatCurrency(totalMonthly) + "/mo")}\n`);
      }

      // ── Aggregated warnings ──
      const allWarnings = resolvedLines.flatMap((l) => l.warnings);
      if (allWarnings.length > 0) {
        process.stderr.write("\n");
        for (const w of allWarnings) {
          process.stderr.write(chalk.yellow(`  ⚠ ${w}\n`));
        }
      }

      process.stderr.write("\n");

      // ── Confirmation ──
      // Single-line, non-dry-run keeps the existing [y/n/c] flow that lets
      // users edit the quantity inline. Multi-line and dry-run use a simple
      // [y/n] — there's no single quantity to edit in multi-line, and a
      // dry-run wants to lock the input as-is so the validation reflects
      // exactly what would be submitted.
      let confirmedQuantities: number[];
      if (dryRun || isMulti) {
        const promptText = dryRun
          ? `Run dry-run validation?`
          : `Place this order?`;
        const ok = await confirm(promptText, { default: true });
        if (!ok) {
          process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
          return false;
        }
        confirmedQuantities = resolvedLines.map((l) => l.quantity);
      } else {
        const line = resolvedLines[0];
        const confirmedQty = await confirmWithChange(
          `Place order for ${formatQuantity(line.quantity)}?`,
          line.quantity,
        );
        if (confirmedQty === null) {
          process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
          return false;
        }
        confirmedQuantities = [confirmedQty];
      }

      const spinner = createSpinner(dryRun ? "Validating order..." : "Creating order...").start();

      // ── Build API input ──
      // `lineItemNumber` is required by the spec's `CreateLineItem` shape
      // (used by `parentLineItemNumber` for child line items within the
      // same order). The CLI doesn't expose it as user-facing input — it's
      // a 1-based sequential index matching array position. See #331.
      const lineItems: OrderLineItemCreateInput[] = resolvedLines.map((line, idx) => ({
        productId: line.productId,
        lineItemNumber: idx + 1,
        quantity: confirmedQuantities[idx],
        billingTerm: line.billingTerm as BillingTerm,
        ...(line.commitmentTermId ? { commitmentTermId: line.commitmentTermId } : {}),
        ...(line.provisioningDetails && line.provisioningDetails.length > 0
          ? { provisioningDetails: line.provisioningDetails }
          : {}),
      }));

      const orderInput: CreateOrderInput = {
        companyId: resolvedCompanyId,
        lineItems,
      };

      // v0.2 plan (#474): once the Pax8 API honors an `Idempotency-Key`
      // request header on POST /orders, forward `idempotencyKey` through
      // OrdersApi.create so the server dedupes natively. Until then,
      // deduplication is purely host-local via the file cache below —
      // cross-host / cross-process retries with the same key are NOT
      // deduped. The CLI help text and docs/UX_GUIDE.md are explicit about
      // this limitation; don't reintroduce the "replay-safe" wording
      // without first wiring the wire-level header.
      const doneWrite = markWriteInFlight("orders", undefined, idempotencyKey);
      let order;
      try {
        order = await ctx.api.orders.create(orderInput, { isMock: dryRun });
      } finally {
        doneWrite();
      }
      // Dry-runs don't mutate any partner state, so there's nothing to
      // invalidate. Real creates need the cache busted so subsequent
      // `orders list` / `subscriptions list` calls reflect the new state.
      if (!dryRun) await invalidateCacheAfterWrite();

      if (dryRun) {
        spinner.succeed("Dry-run validation succeeded");
      } else {
        spinner.succeed("Order created 🎉");
      }

      // ── Telemetry ──
      const totalSeats = confirmedQuantities.reduce((a, b) => a + b, 0);
      const orderTotalDollars = resolvedLines.reduce((acc, l, idx) => {
        if (!l.unitPrice) return acc;
        return acc + l.unitPrice * confirmedQuantities[idx];
      }, 0);
      const orderMrrImpact = resolvedLines.reduce((acc, l, idx) => {
        if (!l.unitPrice) return acc;
        return acc + calculateMrr(l.unitPrice, confirmedQuantities[idx], l.billingTerm);
      }, 0);
      setTelemetryFields({
        order_success: !dryRun,
        order_dry_run: dryRun || undefined,
        order_total_dollars: orderTotalDollars > 0 ? orderTotalDollars : undefined,
        order_mrr_impact: orderMrrImpact > 0 ? orderMrrImpact : undefined,
        order_seats: totalSeats,
        order_line_count: resolvedLines.length,
      });

      // ── JSON output ──
      if (ctx.outputFormat === "json") {
        const jsonMrr = orderMrrImpact > 0 ? Number(orderMrrImpact.toFixed(2)) : null;
        const monthlyCost = jsonMrr;
        const annualCost = jsonMrr ? Number((jsonMrr * 12).toFixed(2)) : null;
        const enriched: Record<string, unknown> = {
          ...order,
          dryRun: dryRun || undefined,
          monthlyCost: monthlyCost ?? null,
          annualCost: annualCost ?? null,
        };
        // Single-line back-compat: surface unitPrice at the top level when
        // there's exactly one line item, matching the pre-#246 shape.
        if (!isMulti && resolvedLines[0]?.unitPrice !== null) {
          enriched.unitPrice = resolvedLines[0]?.unitPrice ?? null;
        }
        process.stdout.write(JSON.stringify(enriched, null, 2) + "\n");
        return true;
      }

      // ── Human output ──
      if (dryRun) {
        process.stdout.write(chalk.yellow.bold("\n  DRY RUN — no order placed\n"));
      }

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("Order ID:".padEnd(18))}${order.id}\n`);
      if (order.status) process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(order.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Company:".padEnd(18))}${companyName}\n`);

      if (!isMulti) {
        const line = resolvedLines[0];
        const seats = confirmedQuantities[0];
        process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${line.productName}\n`);
        process.stdout.write(`  ${chalk.dim("Seats:".padEnd(18))}${formatQuantity(seats)}\n`);
        if (line.unitPrice) {
          process.stdout.write(`  ${chalk.dim("Unit price:".padEnd(18))}${formatCurrency(line.unitPrice)}/seat/${line.billingTerm === "Annual" ? "yr" : "mo"}\n`);
        } else {
          process.stdout.write(`  ${chalk.dim("Unit price:".padEnd(18))}${chalk.dim("—")}\n`);
        }
      } else {
        process.stdout.write(`  ${chalk.dim("Line Items:".padEnd(18))}${resolvedLines.length}\n`);
        resolvedLines.forEach((line, idx) => {
          process.stdout.write(`    ${chalk.dim(`#${idx + 1}`)} ${line.productName} × ${formatQuantity(confirmedQuantities[idx])} (${line.billingTerm})\n`);
        });
      }

      const finalAnnual = orderMrrImpact > 0 ? Number((orderMrrImpact * 12).toFixed(2)) : null;
      if (orderMrrImpact > 0) {
        process.stdout.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.green.bold(formatCurrency(orderMrrImpact) + "/mo")}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Monthly cost:".padEnd(18))}${chalk.dim("—")}\n`);
      }
      if (finalAnnual) {
        process.stdout.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.green(formatCurrency(finalAnnual) + "/yr")}\n`);
      } else {
        process.stdout.write(`  ${chalk.dim("Annual cost:".padEnd(18))}${chalk.dim("—")}\n`);
      }
      process.stdout.write("\n");

      // ── Next steps ──
      process.stderr.write(chalk.dim("  Try next:\n"));
      if (dryRun) {
        // After a successful dry-run, the next obvious step is to submit
        // the same payload for real.
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders create ... (re-run without --dry-run)`))}  ${chalk.dim("place the order")}\n`);
      } else {
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders show ${order.id}`))}  ${chalk.dim("check order status")}\n`);
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 subscriptions list --company "${companyName}"`))}  ${chalk.dim("view subscriptions")}\n`);
      }
      process.stderr.write("\n");
          return true;
        },
      );
    } catch (error) {
      // withIdempotency restores stdout via try/finally before bubbling the
      // error here. We don't persist the cache entry on failure — the agent
      // can retry with the same key.
      // Provide order-specific error messages with actionable guidance
      if (error instanceof ApiError) {
        const displayProduct = productName || allOpts.product || "product";
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
                `View ${displayCompany}'s current subscriptions: ${replCmd("pax8 clients more")} "${displayCompany}"`,
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
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product ?? displayProduct}`);

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
          steps.push(`View product details: ${replCmd("pax8 products show")} ${allOpts.product ?? displayProduct}`);

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
