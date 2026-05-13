// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { replCmd } from "../../lib/confirm.js";

export const productsSearchCommand = new Command("search")
  .description("Search products by name")
  .argument("<query>", "Search query")
  .option("--vendor <name>", "Filter by vendor name")
  .addHelpText(
    "after",
    `
Examples:
  pax8 products search "Microsoft 365"
  pax8 products search defender --vendor Microsoft
  pax8 products search backup --json`
  )
  .action(async (query: string, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching products...");

    try {
      spinner.start();
      // The Pax8 API's `search` param only honors single-word values, so
      // pass the longest token from the query and filter the rest
      // client-side. Without this we'd be limited to the first 200
      // products of a 2,600+ catalog.
      const tokens = query.split(/\s+/).filter(Boolean);
      const apiKeyword = tokens.reduce(
        (best: string, t: string) => (t.length >= best.length ? t : best),
        ""
      );
      const result = await ctx.api.products.list({
        vendorName: options.vendor,
        search: apiKeyword || undefined,
        size: 200,
      });
      spinner.stop();

      const q = query.toLowerCase();
      const queryTokens = q.split(/\s+/).filter(Boolean);
      const matches = result.content.filter((p) => {
        const name = p.name.toLowerCase();
        return name.includes(q) || queryTokens.every((t) => name.includes(t));
      });

      const columns = [
        { key: "name", header: "Name", width: 40 },
        { key: "vendorName", header: "Vendor", width: 20 },
        { key: "sku", header: "SKU", width: 30 },
        { key: "unitOfMeasure", header: "Category", width: 15 },
      ];

      // Route the empty-search case through the standard `output()` helper so
      // it picks up the same "Filters applied:" / "Try next:" block partners
      // see on every other list command. JSON mode still emits `[]` (the
      // pipeline contract); CSV still emits a header-only row.
      if (matches.length === 0) {
        const filtersApplied: Record<string, string> = { query: `"${query}"` };
        if (options.vendor) filtersApplied.vendor = `"${options.vendor}"`;
        output([], {
          format: ctx.outputFormat,
          columns,
          emptyState: {
            headline: `No products matching "${query}".`,
            filtersApplied,
            reasons: [
              "The search may be too narrow, or the catalog doesn't carry that name.",
            ],
            suggestions: [
              {
                command: "pax8 products search <broader-query>",
                description: "try a shorter or more generic term",
              },
              {
                command: "pax8 products list",
                description: "browse the full catalog",
              },
            ],
          },
        });
        return;
      }

      output(matches, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(chalk.dim(`\n  ${matches.length} products\n`));
        if (matches.length > 0) {
          const first = matches[0] as Record<string, unknown>;
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 products show ${first.id}`))}  ${chalk.dim("view details & pricing")}\n`);
          process.stderr.write(`    ${chalk.cyan(replCmd(`pax8 orders create --product <id> --company <id> --quantity <n>`))}  ${chalk.dim("place an order")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to search products");
    }
  });
