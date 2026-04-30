import { Command } from "commander";
import chalk from "chalk";
import { getRecommendations, getPortfolioCoverage } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { ALL_SUBS_PAGE_SIZE } from "@pax8/core";
import { replCmd } from "../../lib/confirm.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatCompanyName, formatCurrency } from "../../lib/formatters.js";
import { saveLastList } from "../../lib/last-list.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

const baseColumns: Column[] = [
  { key: "_num", header: "#" },
  { key: "name", header: "Company", format: (v) => formatCompanyName(String(v), 30) },
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
];

const coverageColumns: Column[] = [
  ...baseColumns,
  { key: "_coverage", header: "Coverage" },
  { key: "_missing", header: "Missing" },
  {
    key: "_potential",
    header: "Potential",
    format: (v) => {
      const n = v as number;
      return n > 0 ? chalk.green(`+${formatCurrency(n)}/mo`) : chalk.dim("—");
    },
  },
];

export const companiesListCommand = new Command("list")
  .description("List all companies")
  .option("--status <status>", "Filter by status (Active, Inactive, Deleted)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option("--coverage", "Include portfolio coverage analysis")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies list
  pax8 companies list --status Active
  pax8 companies list --page 1 --size 25
  pax8 companies list --coverage
  pax8 companies list --json
  pax8 companies list --csv
  pax8 companies list --ids-only
  pax8 companies list --ids-only | xargs -I{} pax8 subscriptions list --company {}`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching companies...").start();

    try {
      const ctx = await buildContext(allOpts);
      const userPage = parseInt(allOpts.page, 10);
      const pageSize = parseInt(allOpts.size, 10);
      const apiPage = Math.max(userPage - 1, 0); // User sees 1-based, API is 0-based
      const result = await ctx.api.companies.list({
        page: apiPage,
        size: pageSize,
        status: allOpts.status,
      });

      if (allOpts.idsOnly) {
        spinner.stop();
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // Determine if we should fetch coverage data
      const wantsCoverage = allOpts.coverage || ctx.outputFormat === "json";

      // Build coverage map if requested
      let coverageMap: Map<string, { coverage: string; missingCategories: string[]; estimatedUplift: number; coveredCategories: string[] }> | null = null;

      if (wantsCoverage) {
        spinner.text = "Analyzing portfolio coverage...";

        // Fetch all subscriptions for the listed companies
        const companyIds = result.content.map((c: Record<string, unknown>) => String(c.id));
        const subsResult = await ctx.api.subscriptions.list({ size: ALL_SUBS_PAGE_SIZE, status: "Active" });
        const subs = subsResult.content;

        // Enrich product names
        await enrichProductNames(ctx, subs);

        // Build company name lookup
        const companyNames = new Map<string, string>();
        for (const c of result.content) {
          companyNames.set(c.id, c.name);
        }
        enrichCompanyNames(companyNames, subs);

        // Get recommendations for uplift estimates
        const report = getRecommendations(subs);
        const portfolioCoverage = getPortfolioCoverage(subs, report.recommendations);

        coverageMap = new Map();
        for (const companyId of companyIds) {
          const cov = portfolioCoverage.get(companyId);
          if (cov) {
            coverageMap.set(companyId, {
              coverage: cov.coverage,
              missingCategories: cov.missingCategories,
              estimatedUplift: cov.estimatedUplift,
              coveredCategories: cov.coveredCategories,
            });
          } else {
            // Company has no active subscriptions
            coverageMap.set(companyId, {
              coverage: "0/7",
              missingCategories: [],
              estimatedUplift: 0,
              coveredCategories: [],
            });
          }
        }
      }

      spinner.stop();

      // Row numbers continue across pages (page 2 starts at 26, not 1)
      const startNum = apiPage * pageSize;
      const numbered = result.content.map((c: Record<string, unknown>, i: number) => {
        const row: Record<string, unknown> = {
          ...c,
          _num: String(startNum + i + 1),
        };

        if (coverageMap) {
          const cov = coverageMap.get(String(c.id));
          if (cov) {
            row._coverage = cov.coverage;
            row._missing = cov.missingCategories.length > 0
              ? cov.missingCategories.map((c) => c.replace(/_/g, " ")).join(", ")
              : "";
            row._potential = cov.estimatedUplift;
            // For JSON output, include structured fields
            row.coverage = cov.coverage;
            row.coveredCategories = cov.coveredCategories;
            row.missingCategories = cov.missingCategories;
            row.estimatedUplift = cov.estimatedUplift;
          }
        }

        return row;
      });

      await saveLastList(
        result.content.map((c: Record<string, unknown>, i: number) => ({
          index: startNum + i + 1,
          id: String(c.id),
          name: String(c.name),
        }))
      );

      // Save pending actions for REPL number input (typing "3" drills into company #3)
      try {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { homedir } = await import("os");
        const { join } = await import("path");
        const dir = join(homedir(), ".pax8");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "pending-actions.json"), JSON.stringify(
          result.content.map((c: Record<string, unknown>, i: number) => ({
            key: String(startNum + i + 1),
            command: `companies more ${startNum + i + 1}`,
          }))
        ));
      } catch { /* best effort */ }

      const columns = coverageMap ? coverageColumns : baseColumns;
      output(numbered, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        const currentPage = result.page.number; // 0-based from API
        const totalPages = result.page.totalPages;
        const totalElements = result.page.totalElements;

        let pageInfo = `${totalElements} companies`;
        if (totalPages > 1) {
          pageInfo += ` · page ${currentPage + 1}/${totalPages}`;
        }
        process.stderr.write(chalk.dim(`\n  ${pageInfo}\n`));

        if (totalPages > 1 && currentPage < totalPages - 1) {
          process.stderr.write(
            chalk.dim("  Next page: ") + chalk.cyan(replCmd(`pax8 companies list --page ${currentPage + 2}`)) + "\n"
          );
        }

        if (!allOpts.coverage) {
          process.stderr.write(
            chalk.dim("  Add ") + chalk.cyan("--coverage") + chalk.dim(" to see portfolio gaps and revenue opportunities\n")
          );
        }

        // Interactive: pick a company to drill into
        const steps: NextStep[] = result.content.map(
          (c: Record<string, unknown>, i: number) => ({
            key: String(startNum + i + 1),
            label: String(c.name),
            command: ["companies", "more", String(c.name)],
          })
        );
        await promptNextSteps(steps);
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list companies");
    }
  });
