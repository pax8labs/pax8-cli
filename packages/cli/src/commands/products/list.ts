// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import {
  output,
  buildPageEnvelope,
  renderPaginationFooter,
  displayCommandFromArgs,
} from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";

export const productsListCommand = new Command("list")
  .description("List products in the Pax8 catalog")
  .option("--vendor <name>", "Filter by vendor name")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 products list
  pax8 products list --vendor Microsoft
  pax8 products list --size 10 --page 2
  pax8 products list --json
  pax8 products list --csv
  pax8 products list --ids-only | xargs -I{} pax8 products show {}`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching products...");

    try {
      spinner.start();
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      const result = await ctx.api.products.list({
        vendorName: allOpts.vendor,
        page: apiPage,
        size: parseInt(allOpts.size, 10),
      });
      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // #483: wrap JSON as { products, page } + standardize footer.
      // #562: argv form for next-page nav.
      const pageEnvelope = buildPageEnvelope(result.page);
      const nextPageArgs: string[] = [
        "pax8", "products", "list",
        "--page", String(pageEnvelope.number + 1),
        "--size", String(pageEnvelope.size),
        ...(allOpts.vendor ? ["--vendor", String(allOpts.vendor)] : []),
      ];
      const nextPageCommand = displayCommandFromArgs(nextPageArgs);

      if (ctx.outputFormat === "json") {
        process.stdout.write(
          JSON.stringify({ products: result.content, page: pageEnvelope }, null, 2) + "\n",
        );
        return;
      }

      const columns = [
        { key: "name", header: "Name", width: 40 },
        { key: "vendorName", header: "Vendor", width: 20 },
        { key: "sku", header: "SKU", width: 30 },
        { key: "unitOfMeasure", header: "Category", width: 15 },
      ];

      const filtersApplied: Record<string, string> = {};
      if (allOpts.vendor) filtersApplied.vendor = `"${allOpts.vendor}"`;
      const emptyReasons: string[] = [];
      if (Object.keys(filtersApplied).length === 0) {
        emptyReasons.push("The catalog may not be reachable.");
      }

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No products found.",
          filtersApplied: Object.keys(filtersApplied).length > 0 ? filtersApplied : undefined,
          reasons: emptyReasons.length > 0 ? emptyReasons : undefined,
          suggestions: [
            {
              command: "pax8 products list",
              description: "browse without filters",
            },
            {
              command: "pax8 products search <query>",
              description: "search the catalog by name or SKU",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table") {
        renderPaginationFooter(pageEnvelope, {
          resourceSingular: "product",
          nextPageCommand,
          rowCount: result.content.length,
        });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list products");
    }
  });
