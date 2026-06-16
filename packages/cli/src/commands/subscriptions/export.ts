// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  SubscriptionStatusSchema,
  BillingTermSchema,
  type Subscription,
} from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { validateEnum } from "../../lib/validate.js";

const SUBSCRIPTION_STATUS_VALUES = SubscriptionStatusSchema.options as readonly string[];
const BILLING_TERM_VALUES = BillingTermSchema.options as readonly string[];

// CSV columns are curated for the raw-export use case — Excel /
// spreadsheets / dbt / BI tooling. These are the same fields
// `subscriptions list --json` already emits today; if the API ever
// adds a field to `Subscription` that partners need, add it here.
// Order is by likely-relevance: id first, then the human-readable
// identifying fields, then quantitative + temporal fields, then
// trailing metadata.
const CSV_COLUMNS = [
  "id",
  "companyId",
  "companyName",
  "productId",
  "productName",
  "quantity",
  "price",
  "currencyCode",
  "billingTerm",
  "status",
  "startDate",
  "endDate",
  "commitmentTermEndDate",
  "createdAt",
  "updatedAt",
] as const;

type Format = "csv" | "jsonl" | "json";
const FORMAT_VALUES = ["csv", "jsonl", "json"] as const satisfies readonly Format[];

/**
 * RFC-4180-style CSV escaping. Wraps any field containing comma,
 * quote, newline, or carriage return in double quotes, and doubles
 * any embedded double quotes. Numbers and `null`/`undefined` are
 * stringified to "" (numbers) or "" (nullish) — same convention
 * spreadsheets read cleanly.
 */
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToCsv(sub: Subscription): string {
  const obj = sub as unknown as Record<string, unknown>;
  return CSV_COLUMNS.map((col) => csvEscape(obj[col])).join(",") + "\n";
}

export const subscriptionsExportCommand = new Command("export")
  .description("Stream the full subscription portfolio to stdout (csv / jsonl / json)")
  .option("--format <fmt>", "Output format: csv, jsonl, or json (default csv)", "csv")
  .option("--company <id|name>", "Filter to a specific company")
  .option(
    "--status <status>",
    `Filter by status (${SUBSCRIPTION_STATUS_VALUES.join(", ")})`,
  )
  .option(
    "--billing-term <term>",
    `Filter by billing term (${BILLING_TERM_VALUES.join(", ")})`,
  )
  .option("--product-id <id>", "Filter by product ID")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions export > subs.csv                       # default CSV to file
  pax8 subscriptions export --format jsonl > subs.jsonl      # one JSON object per line (great for jq)
  pax8 subscriptions export --format json > subs.json        # single JSON array
  pax8 subscriptions export --company "Acme Corp" --format csv > acme.csv
  pax8 subscriptions export --status Active --format jsonl   # filter + stream to stdout

About this command:
  Walks every page of the subscriptions endpoint and streams each row
  to stdout as it arrives — never materializes the full set. Safe for
  arbitrarily large portfolios; memory is bounded regardless of size.

  This is the raw-data path complement to the aggregator commands
  (dashboard, recommendations, audit, report subscriptions), which
  compute summaries. Use export when you want the rows themselves —
  to load into a spreadsheet, dbt model, SQL warehouse, etc.

CSV columns:
  ${CSV_COLUMNS.join(", ")}

  Names (companyName, productName) are included where the API
  provides them. For absolute completeness across all fields, use
  --format json or --format jsonl (both stream the full Subscription
  shape).`,
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    // Format negotiation. Reject unknown formats at the parse boundary
    // so partners get a fail-fast hint rather than a silent fallback.
    const fmtRaw = String(options.format ?? "csv").toLowerCase();
    const fmt = (validateEnum(fmtRaw, FORMAT_VALUES, "--format") ?? "csv") as Format;

    if (options.status) {
      validateEnum(options.status, SUBSCRIPTION_STATUS_VALUES, "--status");
    }
    if (options.billingTerm) {
      validateEnum(options.billingTerm, BILLING_TERM_VALUES, "--billing-term");
    }

    const spinner = createSpinner("Exporting subscriptions...");
    // Don't start the spinner if --quiet is set or stdout is being
    // piped to a non-TTY (the typical `> file.csv` case). Progress
    // updates would compete with the stdout stream and confuse pipes.
    const showProgress = !allOpts.quiet && process.stderr.isTTY;
    if (showProgress) spinner.start();

    try {
      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;

      const filter = {
        ...(companyId ? { companyId } : {}),
        ...(options.status ? { status: options.status } : {}),
        ...(options.billingTerm ? { billingTerm: options.billingTerm } : {}),
        ...(options.productId ? { productId: options.productId } : {}),
      };

      // For JSON-array format we need to bracket the output. JSONL and
      // CSV don't — each row is self-contained. The CSV header is
      // written before any rows.
      let exported = 0;
      let firstRow = true;

      if (fmt === "csv") {
        process.stdout.write(CSV_COLUMNS.join(",") + "\n");
      } else if (fmt === "json") {
        process.stdout.write("[\n");
      }

      for await (const page of ctx.api.subscriptions.streamAll(filter)) {
        for (const sub of page.content) {
          if (fmt === "csv") {
            process.stdout.write(rowToCsv(sub));
          } else if (fmt === "jsonl") {
            process.stdout.write(JSON.stringify(sub) + "\n");
          } else {
            // json: each row preceded by `,\n` except the first
            if (!firstRow) process.stdout.write(",\n");
            process.stdout.write("  " + JSON.stringify(sub));
            firstRow = false;
          }
          exported++;
        }
        if (showProgress) {
          const total = page.page.totalElements;
          spinner.text = `Exporting subscriptions... (${exported.toLocaleString()} of ${total.toLocaleString()})`;
        }
      }

      if (fmt === "json") {
        process.stdout.write("\n]\n");
      }

      if (showProgress) {
        spinner.succeed(
          `Exported ${exported.toLocaleString()} subscription${exported === 1 ? "" : "s"}.`,
        );
      } else if (!allOpts.quiet) {
        // Non-TTY stderr: emit a single end-of-run summary so the user
        // who ran the pipeline still has a record of what happened.
        process.stderr.write(
          chalk.dim(
            `  Exported ${exported.toLocaleString()} subscription${exported === 1 ? "" : "s"}.\n`,
          ),
        );
      }
    } catch (error) {
      if (showProgress) spinner.stop();
      await handleCommandError(error, undefined, "Failed to export subscriptions");
    }
  });
