// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
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

      const columns = [
        { key: "name", header: "Name", width: 40 },
        { key: "vendorName", header: "Vendor", width: 20 },
        { key: "sku", header: "SKU", width: 30 },
        { key: "unitOfMeasure", header: "Category", width: 15 },
      ];

      const emptyReasons: string[] = [];
      if (allOpts.vendor) {
        emptyReasons.push(`No products match --vendor "${allOpts.vendor}".`);
      }
      emptyReasons.push("The catalog may not be reachable, or filters are too narrow.");

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: "No products found.",
          reasons: emptyReasons,
          suggestions: [
            {
              command: "pax8 products search <query>",
              description: "search the catalog by name or SKU",
            },
            {
              command: "pax8 products list",
              description: "browse without filters",
            },
          ],
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.page.totalElements} products\n\n`)
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list products");
    }
  });
