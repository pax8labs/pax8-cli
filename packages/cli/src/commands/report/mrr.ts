import { Command } from "commander";
import chalk from "chalk";
import { buildContext, warnIfTruncated } from "../../lib/context.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichCompanyNames, enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { ALL_SUBS_PAGE_SIZE, computeMrr } from "@pax8/core";
import { output } from "../../lib/output.js";

export const reportMrrCommand = new Command("mrr")
  .description("Estimated MRR breakdown by company")
  .addHelpText("after", `
Examples:
  pax8 report mrr
  pax8 report mrr --json
  pax8 report mrr --csv`)
  .action(async (_options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Calculating estimated MRR...").start();

    try {
      // Fetch subscriptions and companies in parallel
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      warnIfTruncated(subsResult, ALL_SUBS_PAGE_SIZE);

      // Build company name lookup and enrich
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }
      enrichCompanyNames(companyNames, subsResult.content);
      await enrichProductNames(ctx, subsResult.content);

      spinner.succeed("Estimated MRR calculated");

      const report = computeMrr(subsResult.content);
      const projectedArr = report.totalMrr * 12;

      // Count active subs per company
      const activeSubs = subsResult.content.filter(
        (s) => (s.status ?? "").toLowerCase() === "active",
      );
      const subsPerCompany = new Map<string, number>();
      for (const sub of activeSubs) {
        const cid = sub.companyId ?? "";
        subsPerCompany.set(cid, (subsPerCompany.get(cid) ?? 0) + 1);
      }

      // Build company rows with pctOfTotal
      const companies = report.byCompany.map((c) => ({
        name: c.companyName || c.companyId,
        activeSubs: subsPerCompany.get(c.companyId) ?? 0,
        mrr: Number(c.mrr.toFixed(2)),
        pctOfTotal: report.totalMrr > 0
          ? Number(((c.mrr / report.totalMrr) * 100).toFixed(1))
          : 0,
      }));

      // Build nextActions
      const nextActions: { command: string; description: string }[] = [];
      if (companies.length > 0) {
        nextActions.push({
          command: `pax8 companies more "${companies[0].name}"`,
          description: `Drill into top customer ${companies[0].name}`,
        });
      }
      nextActions.push({
        command: "pax8 report growth",
        description: "View MRR growth trend over recent months",
      });
      nextActions.push({
        command: "pax8 recommendations list",
        description: "Find upsell opportunities to grow estimated MRR",
      });

      // JSON output
      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify({
          totalMrr: Number(report.totalMrr.toFixed(2)),
          projectedArr: Number(projectedArr.toFixed(2)),
          companies,
          nextActions,
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // CSV output
      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "name", header: "Company" },
          { key: "activeSubs", header: "Active Subs" },
          { key: "mrr", header: "Est. MRR" },
          { key: "pctOfTotal", header: "% of Total" },
        ];
        output(companies as unknown as Record<string, unknown>[], { format: "csv", columns });
        return;
      }

      // Table output
      const out = process.stdout;
      out.write("\n");
      out.write(chalk.bold("  Estimated MRR Breakdown by Company\n\n"));

      const nameWidth = 26;
      const header = `  ${chalk.cyan.bold("Company".padEnd(nameWidth))}  ${chalk.cyan.bold("Active Subs".padStart(11))}  ${chalk.cyan.bold("Est. MRR".padStart(12))}  ${chalk.cyan.bold("% of Total".padStart(10))}`;
      out.write(header + "\n");
      out.write(`  ${"─".repeat(nameWidth)}  ${"─".repeat(11)}  ${"─".repeat(12)}  ${"─".repeat(10)}\n`);

      for (const c of companies) {
        const name = formatCompanyName(c.name, nameWidth).padEnd(nameWidth);
        const subs = String(c.activeSubs).padStart(11);
        const mrr = formatCurrency(c.mrr).padStart(12);
        const pct = `${c.pctOfTotal.toFixed(0)}%`.padStart(10);
        out.write(`  ${name}  ${subs}  ${mrr}  ${chalk.dim(pct)}\n`);
      }

      out.write(`  ${"".padEnd(nameWidth)}  ${"".padEnd(11)}  ${"─".repeat(12)}\n`);
      out.write(`  ${"Total estimated MRR".padEnd(nameWidth)}  ${"".padEnd(11)}  ${chalk.bold(formatCurrency(report.totalMrr).padStart(12))}\n`);
      out.write(`  ${"Projected ARR".padEnd(nameWidth)}  ${"".padEnd(11)}  ${chalk.bold(formatCurrency(projectedArr).padStart(12))}\n`);
      out.write("\n");
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to calculate estimated MRR");
    }
  });
