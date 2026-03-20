import { Command } from "commander";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";

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
  .action(async (query, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Searching products…");

    try {
      spinner.start();
      // Fetch all products (with optional vendor filter), then filter client-side by name
      const result = await ctx.api.products.list({
        vendorName: options.vendor,
        size: 200,
      });
      spinner.stop();

      const q = query.toLowerCase();
      const matches = result.content.filter((p: any) =>
        p.name.toLowerCase().includes(q)
      );

      if (matches.length === 0) {
        if (ctx.outputFormat === "json") {
          output([], { format: "json" });
        } else if (ctx.outputFormat !== "quiet") {
          process.stderr.write(
            `\n  No products matching '${query}' found.\n\n`
          );
        }
        return;
      }

      const columns = [
        { key: "name", header: "Name", width: 40 },
        { key: "vendorName", header: "Vendor", width: 20 },
        { key: "sku", header: "SKU", width: 30 },
        { key: "unitOfMeasure", header: "Category", width: 15 },
      ];

      output(matches, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        process.stderr.write(
          `\n  ${matches.length} products\n\n`
        );
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to search products");
    }
  });
