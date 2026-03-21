import { Command } from "commander";
import chalk from "chalk";
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
    const spinner = createSpinner("Fetching products...");

    try {
      spinner.start();
      // Fetch all products (with optional vendor filter), then filter client-side by name
      const result = await ctx.api.products.list({
        vendorName: options.vendor,
        size: 200,
      });
      spinner.stop();

      const q = query.toLowerCase();
      const matches = result.content.filter((p) =>
        p.name.toLowerCase().includes(q)
      );

      if (matches.length === 0) {
        if (ctx.outputFormat === "json") {
          output([], { format: "json" });
        } else if (ctx.outputFormat !== "quiet") {
          process.stderr.write(
            chalk.dim(`\n  No products matching "${query}". Try a broader search.\n\n`)
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
        process.stderr.write(chalk.dim(`\n  ${matches.length} products\n`));
        if (matches.length > 0) {
          const first = matches[0] as Record<string, unknown>;
          process.stderr.write(chalk.dim("\n  Try next:\n"));
          process.stderr.write(`    ${chalk.cyan(`pax8 products show ${first.id}`)}  ${chalk.dim("view details & pricing")}\n`);
          process.stderr.write(`    ${chalk.cyan(`pax8 orders create --product <id> --company <id> --quantity <n>`)}  ${chalk.dim("place an order")}\n`);
        }
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to search products");
    }
  });
