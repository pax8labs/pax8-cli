// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  getRecommendations,
  getPortfolioCoverage,
  CompanyStatusSchema,
  type CompanyStatus,
} from "@pax8/core";
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
import { validateEnum } from "../../lib/validate.js";

const COMPANY_STATUS_VALUES = CompanyStatusSchema.options as readonly CompanyStatus[];

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

// #388: --sort accepts spec field names + CLI vocab aliases. The user-facing
// short names (`state`, `zip`) mirror the existing flag vocabulary established
// for `companies create` (docs/UX_GUIDE.md); the wire field names are
// `stateOrProvince` / `postalCode`. Keep this map in lock-step with the spec
// enum: `name | city | country | stateOrProvince | postalCode`.
const SORT_ALIASES: Record<string, "name" | "city" | "country" | "stateOrProvince" | "postalCode"> = {
  name: "name",
  city: "city",
  country: "country",
  state: "stateOrProvince",
  stateorprovince: "stateOrProvince",
  zip: "postalCode",
  postalcode: "postalCode",
};

function parseTriBool(raw: unknown): boolean | undefined {
  if (raw === undefined) return undefined;
  if (raw === true) return true;
  if (raw === false) return false;
  const s = String(raw).toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  if (s === "false" || s === "0" || s === "no") return false;
  return undefined;
}

export const companiesListCommand = new Command("list")
  .description("List all companies")
  .option(
    "--status <status>",
    `Filter by status (${COMPANY_STATUS_VALUES.join(", ")})`,
  )
  // ─── Geography filters (#388) ───────────────────────────────────────────
  // Spec params: city, country, stateOrProvince, postalCode. We keep the
  // shorter UX names (`--state`, `--zip`) per the vocabulary mapping
  // established for `companies create` — see docs/UX_GUIDE.md and
  // packages/cli/src/commands/companies/create.ts:226-239.
  .option("--city <city>", "Filter by city (server-side)")
  .option("--state <state>", "Filter by state or province (maps to stateOrProvince on the wire)")
  .option("--country <country>", "Filter by country (server-side)")
  .option("--zip <postalCode>", "Filter by postal code (maps to postalCode on the wire)")
  // ─── Capability filters (#388) ──────────────────────────────────────────
  .option("--self-service [true|false]", "Filter by selfServiceAllowed (capability flag)")
  .option("--bill-on-behalf [true|false]", "Filter by billOnBehalfOfEnabled (capability flag)")
  .option("--order-approval [true|false]", "Filter by orderApprovalRequired (capability flag)")
  // ─── Sort (#388) ─────────────────────────────────────────────────────────
  .option(
    "--sort <field>",
    "Sort by field (name, city, country, state, zip)"
  )
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option("--coverage", "Include portfolio coverage analysis")
  .option("--with-actions", "Wrap JSON output as { companies, nextActions } instead of a flat array")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies list
  pax8 companies list --status Active
  pax8 companies list --city Denver --state CO
  pax8 companies list --country US --sort city
  pax8 companies list --self-service true
  pax8 companies list --bill-on-behalf true --order-approval false
  pax8 companies list --page 1 --size 25
  pax8 companies list --coverage
  pax8 companies list --json
  pax8 companies list --json --with-actions
  pax8 companies list --csv
  pax8 companies list --ids-only
  pax8 companies list --ids-only | xargs -I{} pax8 subscriptions list --company {}`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    // Fail-fast on `--status FooBar` BEFORE buildContext / any network call
    // (#408). Pre-validation the bad value silently round-tripped to the
    // API as a filter and produced an empty list — the partner couldn't
    // tell whether they typo'd or genuinely had no matching companies.
    try {
      validateEnum(allOpts.status, COMPANY_STATUS_VALUES, "--status", {
        cmdHint: "pax8 companies list",
      });
    } catch (error) {
      await handleCommandError(error);
    }
    const spinner = createSpinner("Fetching companies...").start();

    try {
      const ctx = await buildContext(allOpts);
      const userPage = parseInt(allOpts.page, 10);
      const pageSize = parseInt(allOpts.size, 10);
      const apiPage = Math.max(userPage - 1, 0); // User sees 1-based, API is 0-based
      // #388: map CLI vocabulary (`--state`, `--zip`, `--self-service`, ...)
      // onto the spec-canonical query-parameter names that `CompaniesApi.list`
      // expects. The `--sort` field also accepts the shorter aliases. Booleans
      // pass through commander as either a string ("true" / "false" when the
      // user supplies a value) or `true` when the flag is bare; `parseTriBool`
      // normalizes both.
      const sortRaw = allOpts.sort ? String(allOpts.sort).toLowerCase() : undefined;
      const sort = sortRaw ? SORT_ALIASES[sortRaw] : undefined;
      const result = await ctx.api.companies.list({
        page: apiPage,
        size: pageSize,
        status: allOpts.status,
        city: allOpts.city,
        country: allOpts.country,
        stateOrProvince: allOpts.state,
        postalCode: allOpts.zip,
        selfServiceAllowed: parseTriBool(allOpts.selfService),
        billOnBehalfOfEnabled: parseTriBool(allOpts.billOnBehalf),
        orderApprovalRequired: parseTriBool(allOpts.orderApproval),
        sort,
      });

      if (allOpts.idsOnly) {
        spinner.stop();
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // Coverage analysis fires only when explicitly requested via --coverage.
      // JSON output without --coverage returns the basic company shape and
      // skips the 1000-row subscription fetch + product enrichment.
      const wantsCoverage = Boolean(allOpts.coverage);

      // Build coverage map if requested
      let coverageMap: Map<string, { coverage: string; missingCategories: string[]; estimatedUplift: number; coveredCategories: string[] }> | null = null;

      if (wantsCoverage) {
        spinner.text = "Analyzing portfolio coverage...";

        // Fetch all subscriptions for the listed companies
        const companyIds = result.content.map((c) => String(c.id));
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
      const numbered = result.content.map((c, i) => {
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
        result.content.map((c, i) => ({
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
          result.content.map((_c, i) => ({
            key: String(startNum + i + 1),
            command: `companies more ${startNum + i + 1}`,
          }))
        ));
      } catch { /* best effort */ }

      const columns = coverageMap ? coverageColumns : baseColumns;

      if (ctx.outputFormat === "json" && allOpts.withActions) {
        const nextActions: { command: string; description: string }[] = [];
        // Companies with the largest coverage gaps first if available
        const ranked = coverageMap
          ? [...result.content].sort((a, b) => {
              const aGap = coverageMap!.get(String(a.id))?.estimatedUplift ?? 0;
              const bGap = coverageMap!.get(String(b.id))?.estimatedUplift ?? 0;
              return bGap - aGap;
            })
          : result.content;
        for (const c of ranked.slice(0, 3)) {
          nextActions.push({
            command: `pax8 companies more "${c.name}"`,
            description: `Drill into ${c.name}`,
          });
        }
        if (coverageMap) {
          const top = ranked.find((c) => (coverageMap!.get(String(c.id))?.estimatedUplift ?? 0) > 0);
          if (top) {
            nextActions.push({
              command: `pax8 recommendations list --company "${top.name}" --json`,
              description: `Review growth opportunities for ${top.name}`,
            });
          }
        } else {
          nextActions.push({
            command: "pax8 companies list --coverage --json",
            description: "Re-run with portfolio coverage analysis to surface gaps",
          });
        }
        process.stdout.write(JSON.stringify({ companies: numbered, nextActions }, null, 2) + "\n");
        return;
      }

      const emptyReasons: string[] = [];
      if (allOpts.status) {
        emptyReasons.push(`No companies match --status ${allOpts.status}.`);
      }
      emptyReasons.push("This may be a fresh tenant with no partners onboarded yet.");

      output(numbered, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No companies found.",
          reasons: emptyReasons,
          suggestions: [
            {
              command: replCmd("pax8 companies create --name <name> ..."),
              description: "add your first company",
            },
            {
              command: "PAX8_DEMO=1 pax8 companies list",
              description: "see what an active tenant looks like",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
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
          (c, i) => ({
            key: String(startNum + i + 1),
            label: String(c.name),
            command: ["companies", "more", String(c.name)],
          })
        );
        await promptNextSteps(steps);
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list companies");
    }
  });
