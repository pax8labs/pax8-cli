// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ApiError, isApiTimeoutError, ERROR_API_TIMEOUT } from "@pax8/core";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError, timeoutRecoverySteps } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { output, type Column } from "../../lib/output.js";
import { formatDate } from "../../lib/formatters.js";
import { enrichCompanyNames } from "../../lib/enrich-subscriptions.js";
import { clampListSize, LIST_SIZE_CAP, warnSizeClamped } from "../../lib/validate.js";
import { debugLog } from "../../lib/debug.js";

// #385: timestamp column references the canonical `createdAt`. The legacy
// `createdDate` alias is still emitted on every row in `--json` output for
// backwards compatibility; removal in v0.3.0.
const columns: Column[] = [
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "companyName", header: "Company" },
  { key: "orderedBy", header: "Ordered By" },
  { key: "createdAt", header: "Date", format: (v) => formatDate(String(v)) },
  { key: "lineItems", header: "Items", format: (v) => String(Array.isArray(v) ? v.length : 0) },
];

// #478: when the orders page references company IDs that aren't covered by
// the first companies page, walk additional pages until every referenced ID
// is resolved (or the catalog is exhausted). Capped so a misbehaving server
// can't put us in an unbounded loop. The cap mirrors the platform's largest
// observed partner — 1000 customers — split across 10 pages of 1000.
const COMPANIES_ENRICHMENT_MAX_PAGES = 10;
const COMPANIES_ENRICHMENT_PAGE_SIZE = 1000;

/**
 * Build a {companyId → companyName} map covering every ID referenced in the
 * order rows. Pages through `companies.list` until either the needed IDs are
 * covered or we've hit `COMPANIES_ENRICHMENT_MAX_PAGES`. Surfaces a stderr
 * warning if names remain unresolved after the cap so partners don't see
 * blank `Company` cells with no explanation (#478, defect 4).
 */
async function buildCompanyNameMap(
  ctx: Awaited<ReturnType<typeof buildContext>>,
  orderRows: { companyId?: string }[],
  quiet: boolean,
): Promise<Map<string, string>> {
  const needed = new Set<string>();
  for (const row of orderRows) {
    if (row.companyId) needed.add(String(row.companyId));
  }
  const nameMap = new Map<string, string>();
  if (needed.size === 0) return nameMap;

  for (let page = 0; page < COMPANIES_ENRICHMENT_MAX_PAGES; page++) {
    let result;
    try {
      result = await ctx.api.companies.list({
        page,
        size: COMPANIES_ENRICHMENT_PAGE_SIZE,
      });
    } catch (err) {
      // Enrichment is best-effort — a failed companies fetch shouldn't
      // sink the orders list. Log for diagnostics and stop paging.
      debugLog("companies enrichment fetch failed", err);
      break;
    }
    for (const c of result.content as { id: string; name: string }[]) {
      nameMap.set(c.id, c.name);
    }
    // Early-exit: every referenced ID is now covered.
    const stillMissing = [...needed].some((id) => !nameMap.has(id));
    if (!stillMissing) break;
    // Out of pages on the wire — no point looping further.
    if (page + 1 >= result.page.totalPages) break;
  }

  const unresolved = [...needed].filter((id) => !nameMap.has(id));
  if (unresolved.length > 0 && !quiet) {
    process.stderr.write(
      chalk.dim(
        `  ⚠ ${unresolved.length} order${unresolved.length === 1 ? "" : "s"} reference companies outside the first ${COMPANIES_ENRICHMENT_MAX_PAGES * COMPANIES_ENRICHMENT_PAGE_SIZE} customers — Company column will show a placeholder.\n`,
      ),
    );
  }
  return nameMap;
}

export const ordersListCommand = new Command("list")
  .description("List orders")
  .option("--company <id|name>", "Filter by company ID or name")
  // #478: default sort is `createdAt,desc` (newest first). Pre-#478 the CLI
  // sent no sort hint and the real Pax8 API returned 2013-era orders in row
  // 1 on portfolios with deep history. `--sort` and `--order` let agents
  // override the default — values pass through to the wire as
  // `?sort=<field>,<direction>`. The Pax8 OpenAPI doesn't enumerate the
  // accepted sort fields for `GET /orders`, so we only document `createdAt`
  // (the platform standard) plus an escape hatch for forward-compat: any
  // value passed lands on the wire unchanged.
  .option("--sort <field>", "Sort field (default: createdAt). Other values pass through to the server.", "createdAt")
  .option("--order <direction>", "Sort direction: asc or desc (default: desc)", "desc")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .option(
    "--with-actions",
    "Extend the JSON envelope with nextActions (orders + page are always present)",
  )
  .addHelpText(
    "after",
    `
JSON output is wrapped: { orders, page: { number, size, totalElements, totalPages } }.
The 1-based page number matches what you'd pass as --page. With --with-actions,
nextActions is added (e.g. a "fetch next page" entry on portfolios that span
multiple pages). Default sort is newest-first.

Examples:
  pax8 orders list
  pax8 orders list --company "Summit Healthcare Partners"
  pax8 orders list --page 2 --size 25
  pax8 orders list --sort createdAt --order asc
  pax8 orders list --json
  pax8 orders list --json --with-actions
  pax8 orders list --csv
  pax8 orders list --ids-only | xargs -I{} pax8 orders show {}`,
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching orders...").start();

    try {
      const ctx = await buildContext(allOpts);
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      // #518: cap `--size` at LIST_SIZE_CAP (1000). The orders endpoint
      // returns ~34 MB of JSON for size=50000 — a context-window-killer
      // for agents and an OOM risk for CI runners. Clamp and warn on
      // stderr so the user can switch to `--page N --size 1000` paging.
      const sizeResult = clampListSize(parseInt(allOpts.size, 10), 25);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: allOpts.quiet });
      }
      // #478: build the `sort=<field>,<direction>` wire param from
      // `--sort` / `--order`. Defaults are `createdAt,desc`.
      const sortField = String(allOpts.sort ?? "createdAt");
      const sortOrder = String(allOpts.order ?? "desc").toLowerCase() === "asc" ? "asc" : "desc";
      const sortParam = `${sortField},${sortOrder}`;
      const params: { page: number; size: number; companyId?: string; sort?: string } = {
        page: apiPage,
        size: sizeResult.size,
        sort: sortParam,
      };
      if (allOpts.company) {
        params.companyId = await resolveCompanyId(ctx, allOpts.company);
      }

      const result = await ctx.api.orders.list(params);

      // #478 defect 4: page the companies catalog until every companyId
      // referenced by the orders page is covered. Pre-fix the call was
      // `companies.list({ size: 200 })`, which left the Company column
      // blank for any partner with >200 customers.
      const nameMap = await buildCompanyNameMap(
        ctx,
        result.content as { companyId?: string }[],
        Boolean(allOpts.quiet),
      );
      enrichCompanyNames(nameMap, result.content as Record<string, unknown>[]);

      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // #478 defect 1: surface pagination in the JSON envelope so agents
      // can see "page 1 of 1810 — 45208 orders" instead of silently
      // truncating the answer at row 25. The envelope mirrors the wire
      // page object but renumbers `number` 1-based so it matches the
      // `--page` flag the user would pass next.
      const pageEnvelope = {
        number: result.page.number + 1,
        size: result.page.size,
        totalElements: result.page.totalElements,
        totalPages: result.page.totalPages,
      };
      const onLastPage = pageEnvelope.number >= pageEnvelope.totalPages;
      const hasNextPage = !onLastPage && pageEnvelope.totalPages > 0;

      if (ctx.outputFormat === "json") {
        const orders = result.content;
        if (allOpts.withActions) {
          const nextActions: { command: string; description: string }[] = [];
          if (hasNextPage) {
            const companyFlag = allOpts.company ? ` --company "${allOpts.company}"` : "";
            nextActions.push({
              command: `pax8 orders list --page ${pageEnvelope.number + 1} --size ${pageEnvelope.size}${companyFlag} --json`,
              description: `Fetch the next page of orders (page ${pageEnvelope.number + 1} of ${pageEnvelope.totalPages})`,
            });
          }
          if (orders.length > 0) {
            nextActions.push({
              command: `pax8 orders show ${orders[0].id}`,
              description: `Drill into the most recent order on this page`,
            });
          }
          process.stdout.write(
            JSON.stringify({ orders, page: pageEnvelope, nextActions }, null, 2) + "\n",
          );
        } else {
          process.stdout.write(
            JSON.stringify({ orders, page: pageEnvelope }, null, 2) + "\n",
          );
        }
        return;
      }

      const filtersApplied: Record<string, string> = {};
      if (allOpts.company) filtersApplied.company = `"${allOpts.company}"`;
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("This tenant hasn't placed any orders yet.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No orders found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 orders list",
              description: "list all orders (no filters)",
            },
            {
              command: "pax8 orders create --company <id> --product <id> --quantity <n>",
              description: "place a new order",
            },
          ],
        },
      });

      // #478 defect 1: human footer surfaces "Page X of Y — N orders" plus
      // an explicit `--page <n+1>` hint when more pages exist. Pre-fix the
      // footer just said "45208 orders" and partners had no signal that
      // pagination existed at all.
      if (ctx.outputFormat === "table" && result.content.length > 0) {
        const parts = [
          `Page ${pageEnvelope.number} of ${pageEnvelope.totalPages}`,
          `${pageEnvelope.totalElements} order${pageEnvelope.totalElements === 1 ? "" : "s"}`,
        ];
        if (hasNextPage) {
          const companyFlag = allOpts.company ? ` --company "${allOpts.company}"` : "";
          parts.push(`next: pax8 orders list --page ${pageEnvelope.number + 1}${companyFlag}`);
        }
        process.stderr.write(chalk.dim(`\n  ${parts.join(" — ")}\n\n`));
      }
    } catch (error) {
      // #199: the `/orders` endpoint is known to be slow against tenants with
      // large historical order counts. When the 30s default fires, the generic
      // "Request timed out" message tells the partner nothing useful — surface
      // the concrete knobs they can turn (smaller page size, per-company
      // filter, env-var-driven timeout extension) instead of just the
      // millisecond count.
      if (isApiTimeoutError(error)) {
        const ordersSpecific = [
          "The /orders endpoint can be slow on large portfolios. Try a smaller page size:",
          `    ${chalk.cyan("pax8 orders list --size 10")}`,
          "Or narrow the scope to one customer:",
          `    ${chalk.cyan('pax8 orders list --company "<name>"')}`,
        ];
        // `isApiTimeoutError` guarantees the throw is an `ApiError`; cast
        // through it for the `.message` access. We avoid making the
        // predicate a TypeScript `error is ApiError` form because it would
        // narrow other callers (e.g. `codeForApiError(error: ApiError)`) to
        // `never` in their else-branches.
        const message = (error as ApiError).message;
        await handleCommandError(
          new CliError(
            message,
            undefined,
            timeoutRecoverySteps(ordersSpecific),
            undefined,
            ERROR_API_TIMEOUT,
          ),
          spinner,
          "Failed to list orders",
        );
      }
      await handleCommandError(error, spinner, "Failed to list orders");
    }
  });
