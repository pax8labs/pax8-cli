import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";

export const productsListCommand = new Command("list")
  .description("List products in the Pax8 catalog")
  .option("--vendor <name>", "Filter by vendor name")
  .option("--page <number>", "Page number (0-based)", "0")
  .option("--size <number>", "Page size", "25")
  .addHelpText(
    "after",
    `
Examples:
  pax8 products list
  pax8 products list --vendor Microsoft
  pax8 products list --size 10 --page 1
  pax8 products list --json`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching products…");

    try {
      spinner.start();
      const result = await ctx.api.products.list({
        vendorName: options.vendor,
        page: parseInt(options.page, 10),
        size: parseInt(options.size, 10),
      });
      spinner.stop();

      const columns = [
        { key: "name", header: "Name", width: 40 },
        { key: "vendorName", header: "Vendor", width: 20 },
        { key: "sku", header: "SKU", width: 30 },
        { key: "unitOfMeasure", header: "Category", width: 15 },
      ];

      output(result.content, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          `\n  ${result.page.totalElements} products\n\n`
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list products");
    }
  });
