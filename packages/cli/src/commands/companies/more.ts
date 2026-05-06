// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { categorizeProduct, ALL_CATEGORIES, getRecommendations, getPortfolioCoverage, type ProductCategory } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import {
  formatStatus,
  formatCurrency,
  formatDaysUntil,
  formatDate,
  formatQuantity,
  calculateMrr,
} from "../../lib/formatters.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { output, type Column } from "../../lib/output.js";


interface SubSummary {
  productName: string;
  quantity: number;
  price: number;
  mrr: number;
  status: string;
  billingTerm: string;
  renewsIn: string | null;
  commitmentTermEndDate?: string;
}

interface VendorSummary {
  vendor: string;
  products: number;
  seats: number;
  mrr: number;
}

function extractVendor(productName: string): string {
  const lower = productName.toLowerCase();
  if (lower.includes("microsoft") || lower.includes("m365") || lower.includes("exchange") || lower.includes("defender") || lower.includes("azure") || lower.includes("teams")) return "Microsoft";
  if (lower.includes("acronis")) return "Acronis";
  if (lower.includes("sentinel")) return "SentinelOne";
  if (lower.includes("adobe")) return "Adobe";
  if (lower.includes("google") || lower.includes("workspace")) return "Google";
  if (lower.includes("dropbox")) return "Dropbox";
  if (lower.includes("slack")) return "Slack";
  if (lower.includes("zoom")) return "Zoom";
  return "Other";
}

function daysUntil(dateStr: string | undefined): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export const companiesMoreCommand = new Command("more")
  .description("Full company summary — subscriptions, vendors, seats, estimated MRR, and issues")
  .argument("<name-or-number>", "Company name, ID, or # from companies list")
  .allowExcessArguments(true)
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies more 1                                  Use # from companies list
  pax8 companies more "Summit Healthcare Partners"
  pax8 companies more "Summit Healthcare Partners" --json`
  )
  .action(async (idOrName: string, _options, command: Command) => {
    const allOpts = command.optsWithGlobals();

    // When the user forgets quotes (e.g. companies more [DEMO] Client 17),
    // Commander only captures "[DEMO]" and the rest become excess args.
    if (command.args.length > 1) {
      idOrName = command.args.join(" ");
    }

    const spinner = createSpinner("Fetching company...").start();

    try {
      const ctx = await buildContext(allOpts);

      // Resolve company by number, UUID, or name
      const company = await resolveCompany(ctx, idOrName);

      // Fetch subscriptions and enrich product names
      spinner.text = `Fetching subscriptions for ${company.name}...`;
      let subs;
      try {
        subs = await ctx.api.subscriptions.list({ companyId: company.id, size: 200 });
      } catch {
        subs = { content: [], page: { number: 0, totalPages: 0, totalElements: 0 } };
      }
      if (subs.content.length > 0) {
        await enrichProductNames(ctx, subs.content as Record<string, unknown>[]);
      }
      spinner.succeed(`Loaded ${company.name}`);

      const subscriptions: SubSummary[] = subs.content.map((s) => {
        const qty = Number(s.quantity) || 0;
        const price = Number(s.price) || 0;
        const termEnd = s.commitmentTermEndDate ?? undefined;
        const rawName = s.productName;
        const term = String(s.billingTerm ?? "Monthly");
        const mrr = calculateMrr(price, qty, term);
        return {
          productName: rawName || `Product ${String(s.productId ?? "unknown").slice(0, 8)}`,
          quantity: qty,
          price,
          mrr,
          status: String(s.status),
          billingTerm: term,
          renewsIn: termEnd ? formatDaysUntil(termEnd) : null,
          commitmentTermEndDate: termEnd,
        };
      });

      const activeSubs = subscriptions.filter((s) => s.status === "Active");
      const totalMrr = activeSubs.reduce((sum, s) => sum + s.mrr, 0);
      const totalSeats = activeSubs.reduce((sum, s) => sum + s.quantity, 0);

      // Vendor breakdown
      const vendorMap = new Map<string, VendorSummary>();
      for (const sub of activeSubs) {
        const vendor = extractVendor(sub.productName);
        const existing = vendorMap.get(vendor) || { vendor, products: 0, seats: 0, mrr: 0 };
        existing.products++;
        existing.seats += sub.quantity;
        existing.mrr += sub.mrr;
        vendorMap.set(vendor, existing);
      }
      const vendors = [...vendorMap.values()].map((v) => ({ ...v, mrr: Number(v.mrr.toFixed(2)) })).sort((a, b) => b.mrr - a.mrr);

      // Issues
      const issues: string[] = [];
      for (const sub of activeSubs) {
        const days = daysUntil(sub.commitmentTermEndDate);
        if (days !== null && days <= 30 && days > 0 && sub.billingTerm === "Annual") {
          issues.push(
            `${sub.productName} (${formatQuantity(sub.quantity)}) renews ${sub.renewsIn} — review before auto-renewal`
          );
        }
      }
      const cancelledCount = subscriptions.filter((s) => s.status === "Cancelled").length;
      if (cancelledCount > 0) {
        issues.push(`${cancelledCount} cancelled subscription${cancelledCount > 1 ? "s" : ""}`);
      }
      const trialSubs = subscriptions.filter((s) => s.status === "Trial");
      for (const s of trialSubs) {
        issues.push(`${s.productName} is on trial — convert or cancel`);
      }

      // Portfolio coverage analysis
      const coveredCategories = new Set<ProductCategory>();
      for (const sub of activeSubs) {
        const cats = categorizeProduct(sub.productName);
        for (const c of cats) coveredCategories.add(c);
      }
      const covered = ALL_CATEGORIES.filter((c) => coveredCategories.has(c));
      const missing = ALL_CATEGORIES.filter((c) => !coveredCategories.has(c));

      // Get estimated uplift from recommendations engine
      const subsForRecs = subs.content.map((s) => ({
        companyId: String(s.companyId ?? company.id),
        companyName: company.name,
        productName: String(s.productName ?? ""),
        productId: String(s.productId ?? ""),
        quantity: Number(s.quantity) || 0,
        price: Number(s.price) || 0,
        billingTerm: String(s.billingTerm ?? "Monthly"),
        status: String(s.status ?? ""),
      }));
      const recsReport = getRecommendations(subsForRecs);
      const companyUplift = recsReport.recommendations
        .filter((r) => r.companyId === company.id)
        .reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);

      const coverageInfo = {
        coverage: `${covered.length}/${ALL_CATEGORIES.length}`,
        coveredCategories: covered,
        missingCategories: missing,
        estimatedUplift: Number(companyUplift.toFixed(2)),
      };

      // JSON output
      if (ctx.outputFormat === "json" || ctx.outputFormat === "csv") {
        const result = {
          company: { name: company.name, id: company.id, status: company.status },
          summary: { active_subscriptions: activeSubs.length, total_seats: totalSeats, mrr: Number(totalMrr.toFixed(2)), arr: Number((totalMrr * 12).toFixed(2)) },
          vendors,
          coverage: coverageInfo,
          subscriptions: activeSubs,
          issues,
        };
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
        return;
      }

      // Rich table output
      const W = 60;
      const line = chalk.dim("─".repeat(W));

      process.stdout.write("\n");
      process.stdout.write(chalk.bold.white(`  ${company.name}`) + chalk.dim(`  ${company.id.slice(0, 8)}...`) + "\n");
      const sinceStr = company.created ? chalk.dim("  ·  Since " + formatDate(company.created)) : "";
      process.stdout.write(`  ${formatStatus(company.status)}${sinceStr}` + "\n");
      process.stdout.write("\n");

      // Summary bar
      process.stdout.write(`  ${line}\n`);

      if (activeSubs.length === 0 && subscriptions.length === 0) {
        process.stdout.write(chalk.dim(`  No subscriptions yet\n`));
        process.stdout.write(`  ${line}\n\n`);
        process.stderr.write(chalk.dim("  Get started:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 products search "Microsoft 365"`))}  ${chalk.dim("browse the catalog")}\n`);
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 products search "backup"`))}  ${chalk.dim("find backup solutions")}\n`);
        process.stderr.write("\n");
        return;
      }

      process.stdout.write(
        `  ${chalk.bold(String(activeSubs.length))} subscription${activeSubs.length !== 1 ? "s" : ""}` +
        `    ${chalk.bold(String(totalSeats))} seats` +
        `    ${chalk.bold.green(formatCurrency(totalMrr))}/mo` +
        `    ${chalk.dim(formatCurrency(totalMrr * 12) + "/yr")}\n`
      );
      process.stdout.write(`  ${line}\n`);
      process.stdout.write("\n");

      // Vendor breakdown
      if (vendors.length > 0) {
        process.stdout.write(chalk.dim("  VENDORS\n"));
        for (const v of vendors) {
          const pctBar = totalMrr > 0 ? Math.round((v.mrr / totalMrr) * 20) : 0;
          const bar = chalk.cyan("█".repeat(pctBar)) + chalk.dim("░".repeat(20 - pctBar));
          const pct = totalMrr > 0 ? Math.round((v.mrr / totalMrr) * 100) : 0;
          process.stdout.write(
            `  ${v.vendor.padEnd(14)} ${bar} ${chalk.bold(formatCurrency(v.mrr).padStart(10))}  ${chalk.dim(String(pct) + "%")}  ${chalk.dim(v.seats + " seats")}\n`
          );
        }
        process.stdout.write("\n");
      }

      // Portfolio coverage
      process.stdout.write(chalk.dim("  PORTFOLIO COVERAGE") + chalk.dim(`  ${coverageInfo.coverage}\n`));
      if (covered.length > 0) {
        const coveredStr = covered.map((c) => chalk.green(c.replace(/_/g, " "))).join(chalk.dim(", "));
        process.stdout.write(chalk.dim("  Covered:  ") + coveredStr + "\n");
      }
      if (missing.length > 0) {
        const missingStr = missing.map((c) => chalk.yellow(c.replace(/_/g, " "))).join(chalk.dim(", "));
        process.stdout.write(chalk.dim("  Missing:  ") + missingStr + "\n");
      }
      if (coverageInfo.estimatedUplift > 0) {
        process.stdout.write(chalk.dim("  Potential: ") + chalk.green(`+${formatCurrency(coverageInfo.estimatedUplift)}/mo`) + "\n");
      }
      process.stdout.write("\n");

      // Subscriptions table
      const subColumns: Column[] = [
        { key: "statusIcon", header: "", format: (v) => String(v) },
        { key: "productName", header: "Product" },
        { key: "quantity", header: "Seats", format: (v) => String(v) },
        { key: "mrrDisplay", header: "Est. MRR", format: (v) => String(v) },
        { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
        { key: "renewsIn", header: "Renews", format: (v) => v ? String(v) : chalk.dim("—") },
      ];

      const subRows = subscriptions.map((sub) => ({
        statusIcon: sub.status === "Active" ? chalk.green("●") : sub.status === "Trial" ? chalk.yellow("●") : chalk.red("●"),
        productName: sub.productName,
        quantity: sub.quantity,
        mrrDisplay: formatCurrency(sub.mrr) + "/mo",
        status: sub.status,
        renewsIn: sub.renewsIn,
      }));

      output(subRows as Record<string, unknown>[], { format: "table", columns: subColumns });
      process.stdout.write("\n");

      // Issues
      if (issues.length > 0) {
        process.stdout.write(chalk.yellow.bold(`  ⚠ ${issues.length} issue${issues.length > 1 ? "s" : ""} found\n`));
        for (const issue of issues) {
          process.stdout.write(chalk.yellow(`    • ${issue}\n`));
        }
        process.stdout.write("\n");
      } else {
        process.stdout.write(chalk.green("  ✓ No issues found\n\n"));
      }

      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim("  Try next:\n"));
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 recommendations list --company "${company.name}"`))}  ${chalk.dim("growth opportunities")}\n`);
        process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 subscriptions list --company "${company.name}"`))}  ${chalk.dim("all subscriptions")}\n`);
        process.stderr.write("\n");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("not found") || msg.includes("404") || msg.includes("Not Found")) {
        spinner?.stop();
        process.stderr.write(
          chalk.red.bold(`\n  \u2717 Could not load company summary\n`) +
          chalk.dim(`    The company may not exist or the API returned no data.\n`) +
          chalk.yellow(`    \u2192 Run ${chalk.cyan(replCmd("pax8 companies list"))} to see available companies\n\n`)
        );
        process.exit(1);
        throw new Error("process.exit intercepted");
      }
      await handleCommandError(error, spinner, "Failed to load company summary");
    }
  });
