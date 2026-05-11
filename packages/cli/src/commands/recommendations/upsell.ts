// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  ALL_SUBS_PAGE_SIZE,
  ERROR_INVALID_INPUT,
  findUpsellCohort,
  type UpsellCohortReport,
} from "@pax8/core";
import { buildContext, warnIfTruncated } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { replCmd } from "../../lib/confirm.js";

const columns: Column[] = [
  { key: "companyName", header: "Company", format: (v) => formatCompanyName(String(v)) },
  { key: "fromSeats", header: "Seats" },
  {
    key: "fromMrr",
    header: "Current MRR",
    format: (v) => (v != null ? formatCurrency(v as number) : chalk.dim("—")),
  },
  {
    key: "contactSummary",
    header: "Contacts",
    format: (v) => {
      const s = String(v ?? "");
      return s || chalk.dim("—");
    },
  },
];

export const recommendationsUpsellCommand = new Command("upsell")
  .description("Find companies on one product who don't yet have a target upsell product")
  .requiredOption("--from-product <name>", "The product the cohort already owns (e.g. 'Microsoft 365 Business Basic')")
  .requiredOption("--to-product <name>", "The upsell target the cohort does NOT yet own (e.g. 'Microsoft 365 Business Premium')")
  .option("--limit <number>", "Max rows to show in table (default 20)")
  .option("--with-contacts", "Look up contacts for each matching company (extra API calls)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations upsell --from-product "Microsoft 365 Business Basic" --to-product "Microsoft 365 Business Premium"
  pax8 recommendations upsell --from-product "Business Basic" --to-product "Business Premium" --with-contacts --json
  pax8 recommendations upsell --from-product "Exchange Online (Plan 1)" --to-product "Exchange Online (Plan 2)" --json

About this workflow:
  This is the canonical Pax8 composition for the "proactive upsell" question
  ("who's on product A but not yet on product B?") — equivalent to the
  Pax8 MCP server's "Proactive Upsell Opportunity Finder" pattern
  (Guide §3b), composed over get_subscriptions + get_companies (+ optional
  get_contacts). Use it when you have a specific motion in mind (tier swap,
  edition upgrade); use 'pax8 recommendations list' when you want the
  engine to surface gaps for you.

Output:
  JSON (default for piped/non-TTY): { fromProduct, toProduct, matches[],
  totalFromSeats, totalFromMrr, alreadyHaveToProduct,
  totalFromProductCompanies }. Each match carries opportunityType="Upsell"
  per Pax8 Opportunity Explorer's canonical 5-type taxonomy.`
  )
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const fromProduct = String(options.fromProduct ?? "").trim();
    const toProduct = String(options.toProduct ?? "").trim();

    if (!fromProduct || !toProduct) {
      throw new CliError(
        "Both --from-product and --to-product are required",
        ["The upsell finder needs a source product (the one customers already have) and a target product (the upsell they don't yet have)."],
        [
          `Try: ${replCmd('pax8 recommendations upsell --from-product "Microsoft 365 Business Basic" --to-product "Microsoft 365 Business Premium"')}`,
        ],
        undefined,
        ERROR_INVALID_INPUT,
      );
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Finding upsell cohort...").start();

    try {
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      warnIfTruncated(subsResult, ALL_SUBS_PAGE_SIZE);

      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);
      enrichCompanyNames(companyNames, subs);

      // Optionally fetch contacts for the matched cohort. We do this AFTER
      // the cohort is computed so we only pay the per-company API cost on
      // companies that actually qualify (`getContacts` is a per-company
      // call, not a flat list).
      const baseReport = findUpsellCohort(subs, fromProduct, toProduct, {
        companies: companiesResult.content,
      });

      let report: UpsellCohortReport = baseReport;
      if (options.withContacts && baseReport.matches.length > 0) {
        const allContacts: Array<{ companyId: string; firstName?: string; lastName?: string; email?: string }> = [];
        for (const match of baseReport.matches) {
          try {
            const contactsResult = await ctx.api.contacts.list(match.companyId, { size: 50 });
            for (const c of contactsResult.content) {
              allContacts.push({
                companyId: match.companyId,
                firstName: c.firstName,
                lastName: c.lastName,
                email: c.email,
              });
            }
          } catch {
            /* best effort — skip companies the partner can't read contacts for */
          }
        }
        report = findUpsellCohort(subs, fromProduct, toProduct, {
          companies: companiesResult.content,
          contacts: allContacts,
        });
      }

      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        const rows = report.matches.map((m) => ({
          companyName: m.companyName,
          fromSeats: m.fromSeats,
          fromMrr: m.fromMrr,
          contactSummary: m.contacts.map((c) => c.email).join("; "),
        }));
        output(rows, { format: "csv", columns });
        return;
      }

      // Table mode
      if (report.matches.length === 0) {
        if (report.totalFromProductCompanies === 0) {
          process.stderr.write(
            chalk.yellow(`\n  No companies have an active subscription to "${fromProduct}".\n\n`) +
              chalk.dim(`  Try a broader product name, or list what's actually in use:\n`) +
              `    ${chalk.cyan(replCmd("pax8 subscriptions list --json --size 1000"))}\n\n`,
          );
        } else {
          process.stderr.write(
            chalk.green(
              `\n  ✨ All ${report.totalFromProductCompanies} ${report.totalFromProductCompanies === 1 ? "company" : "companies"} on "${fromProduct}" already have "${toProduct}" — fully upgraded.\n\n`,
            ),
          );
        }
        return;
      }

      const requestedLimit = parseInt(options.limit, 10) || 20;
      const limit = report.matches.length <= 25 ? report.matches.length : requestedLimit;
      const displayed = report.matches.slice(0, limit).map((m) => ({
        companyName: m.companyName,
        fromSeats: m.fromSeats,
        fromMrr: m.fromMrr,
        contactSummary: options.withContacts
          ? m.contacts.slice(0, 2).map((c) => c.email).join(", ") +
            (m.contacts.length > 2 ? ` (+${m.contacts.length - 2} more)` : "")
          : "",
      }));

      // Drop the contacts column if the user didn't ask for them.
      const visibleColumns = options.withContacts ? columns : columns.filter((c) => c.key !== "contactSummary");
      output(displayed, { format: "table", columns: visibleColumns });

      if (report.matches.length > limit) {
        process.stderr.write(
          chalk.dim(`\n  Showing top ${limit} of ${report.matches.length} matches`) +
            chalk.dim(` · use --limit ${report.matches.length} to see all\n`),
        );
      }

      process.stderr.write(
        chalk.dim(
          `\n  ${report.matches.length} ${report.matches.length === 1 ? "company" : "companies"} on "${fromProduct}" without "${toProduct}"`,
        ),
      );
      if (report.alreadyHaveToProduct > 0) {
        process.stderr.write(
          chalk.dim(` · ${report.alreadyHaveToProduct} already upgraded`),
        );
      }
      if (report.totalFromMrr > 0) {
        process.stderr.write(
          chalk.green(` · ${formatCurrency(report.totalFromMrr)}/mo currently on source product`),
        );
      }
      process.stderr.write("\n");

      if (!options.withContacts) {
        process.stderr.write(
          chalk.dim(`\n  Add ${chalk.cyan("--with-contacts")} to pull contact emails per company.\n`),
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to compute upsell cohort");
    }
  });
