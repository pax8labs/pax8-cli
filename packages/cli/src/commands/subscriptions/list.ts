// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { SubscriptionStatusSchema, type SubscriptionStatus } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatStatus,
  formatCurrency,
  formatCompanyName,
} from "../../lib/formatters.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { validateEnum } from "../../lib/validate.js";

// Single source of truth for `--status` accepted values. Mirrors the
// public OpenAPI enum for `GET /subscriptions`'s `status` query parameter
// (per #250 / #408). Help text, examples, and the fail-fast validator
// all read from this array — keeps them from drifting.
const SUBSCRIPTION_STATUS_VALUES = SubscriptionStatusSchema.options as readonly SubscriptionStatus[];
const SUBSCRIPTION_STATUS_HELP = SUBSCRIPTION_STATUS_VALUES.join(", ");

const columns: Column[] = [
  {
    key: "id",
    header: "ID",
    format: (v) => chalk.dim(String(v).slice(0, 8)),
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "productName", header: "Product" },
  { key: "quantity", header: "Qty", format: (v) => String(v) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
  { key: "billingTerm", header: "Term" },
  {
    key: "price",
    header: "Price",
    // Append the ISO-4217 currency code only when it isn't USD. Common case
    // stays unchanged; non-USD partners get e.g. `$1,234.56 EUR` so the unit
    // isn't silently misread as dollars. Surfaced in #273 (fixes #6).
    format: (v, row) => {
      const code = String((row as { currencyCode?: string } | undefined)?.currencyCode ?? "USD");
      const price = formatCurrency(Number(v));
      return code === "USD" ? price : `${price} ${code}`;
    },
  },
];

export const subscriptionsListCommand = new Command("list")
  .description("List subscriptions")
  .option("--company <id|name>", "Filter by company ID or name")
  // Help text mirrors the full public OpenAPI enum for `GET /subscriptions`'s
  // `status` query parameter (#250). Previously the help listed a "...etc."
  // subset that elided 6 of the 10 documented values. Per #408, an unknown
  // value now fails fast at the CLI layer with a helpful "Allowed:" list
  // rather than silently returning an empty array.
  .option(
    "--status <status>",
    `Filter by status (${SUBSCRIPTION_STATUS_HELP})`
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option("--with-actions", "Wrap JSON output as { subscriptions, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions list
  pax8 subscriptions list --company "Summit Healthcare Partners"
  pax8 subscriptions list --status Active
  pax8 subscriptions list --size 10 --page 2
  pax8 subscriptions list --json
  pax8 subscriptions list --json --with-actions
  pax8 subscriptions list --csv
  pax8 subscriptions list --ids-only | xargs -I{} pax8 subscriptions show {}`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    // Fail-fast on `--status FooBar` BEFORE any network call. Pre-#408 this
    // value was passed straight through to the API, which silently returned
    // an empty array — the partner couldn't tell whether they had no
    // matching subscriptions or had typo'd the filter. See partner-
    // walkthrough finding #2.
    try {
      validateEnum(allOpts.status, SUBSCRIPTION_STATUS_VALUES, "--status", {
        cmdHint: "pax8 subscriptions list",
      });
    } catch (error) {
      await handleCommandError(error);
    }
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscriptions...").start();

    try {
      const companyId = allOpts.company
        ? await resolveCompanyId(ctx, allOpts.company)
        : undefined;
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.subscriptions.list({
        companyId,
        status: allOpts.status,
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });

      const subs = result.content as Record<string, unknown>[];
      // Enrich product and company names in parallel
      const companiesPromise = ctx.api.companies.list({ size: 200 });
      await enrichProductNames(ctx, subs);
      try {
        const companies = await companiesPromise;
        const nameMap = new Map((companies.content as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
        enrichCompanyNames(nameMap, subs);
      } catch { /* best effort */ }

      spinner.stop();

      if (options.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "json" && options.withActions) {
        const nextActions: { command: string; description: string }[] = [];
        const subsList = result.content;
        const trials = subsList.filter((s) => (s.status ?? "").toLowerCase() === "trial");
        const top = subsList[0];
        if (top) {
          nextActions.push({
            command: `pax8 subscriptions show ${top.id}`,
            description: `View details for the first subscription (${(top as Record<string, unknown>).productName ?? "subscription"})`,
          });
        }
        if (trials.length > 0) {
          nextActions.push({
            command: "pax8 subscriptions list --status Trial --json",
            description: `Review ${trials.length} trial subscription${trials.length > 1 ? "s" : ""} to convert or cancel`,
          });
        }
        nextActions.push({
          command: "pax8 subscriptions renewals --json --with-actions",
          description: "Check upcoming renewals before they auto-renew",
        });
        process.stdout.write(
          JSON.stringify({ subscriptions: result.content, nextActions }, null, 2) + "\n"
        );
        return;
      }

      const filtersApplied: Record<string, string> = {};
      if (allOpts.company) filtersApplied.company = `"${allOpts.company}"`;
      if (allOpts.status) filtersApplied.status = String(allOpts.status);
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("This tenant has no subscriptions yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No subscriptions found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 subscriptions list",
              description: "list all subscriptions (no filters)",
            },
            {
              command: "pax8 subscriptions list --status Active",
              description: "filter to active subscriptions only",
            },
            {
              command: "pax8 orders create --company <id> --product <id> --quantity <n>",
              description: "place an order to create a subscription",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} subscriptions\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list subscriptions");
    }
  });
