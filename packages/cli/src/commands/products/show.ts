import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";

export const productsShowCommand = new Command("show")
  .description("Show product details")
  .argument("<id>", "Product ID")
  .option("--pricing", "Show pricing tiers")
  .option("--provisioning", "Show provisioning requirements")
  .option("--dependencies", "Show product dependencies")
  .addHelpText(
    "after",
    `
Examples:
  pax8 products show prod-m365-biz-prem-0001
  pax8 products show prod-m365-biz-prem-0001 --pricing
  pax8 products show prod-m365-biz-prem-0001 --provisioning
  pax8 products show prod-m365-biz-prem-0001 --json`
  )
  .action(async (id, options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching product…");

    try {
      spinner.start();
      const product = await ctx.api.products.get(id);

      let pricing = null;
      let provisioning = null;
      let dependencies = null;

      if (options.pricing) {
        pricing = await ctx.api.products.getPricing(id);
      }
      if (options.provisioning) {
        provisioning = await ctx.api.products.getProvisioningDetails(id);
      }
      if (options.dependencies) {
        dependencies = await ctx.api.products.getDependencies(id);
      }
      spinner.stop();

      if (ctx.outputFormat === "json") {
        const data: any = { ...product };
        if (pricing) data.pricingDetails = pricing;
        if (provisioning) data.provisioningDetails = provisioning;
        if (dependencies) data.dependencies = dependencies;
        output([data], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([product], { format: "csv" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Table/human-readable output
      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.bold(product.name)}\n`);
      process.stdout.write(`  ${chalk.dim("Vendor:")} ${product.vendorName}\n`);
      process.stdout.write(`  ${chalk.dim("SKU:")} ${product.sku}\n`);
      process.stdout.write(
        `  ${chalk.dim("Unit:")} ${product.unitOfMeasure}\n`
      );
      process.stdout.write(
        `  ${chalk.dim("Description:")} ${product.shortDescription}\n`
      );

      if (pricing && pricing.length > 0) {
        process.stdout.write(`\n  ${chalk.cyan.bold("Pricing Tiers")}\n`);
        const pricingColumns = [
          { key: "billingTerm", header: "Term", width: 12 },
          {
            key: "partnerBuyPrice",
            header: "Partner Price",
            width: 16,
            format: (v: number) => formatCurrency(v),
          },
          {
            key: "suggestedRetailPrice",
            header: "Retail Price",
            width: 16,
            format: (v: number) => formatCurrency(v),
          },
        ];
        output(pricing, { format: "table", columns: pricingColumns });
      }

      if (provisioning) {
        process.stdout.write(
          `\n  ${chalk.cyan.bold("Provisioning Requirements")}\n`
        );
        process.stdout.write(
          `  ${chalk.dim("Requires Domain:")} ${provisioning.requiresDomain ? "Yes" : "No"}\n`
        );
        process.stdout.write(
          `  ${chalk.dim("Requires Tenant:")} ${provisioning.requiresTenant ? "Yes" : "No"}\n`
        );
        if (provisioning.fields.length > 0) {
          process.stdout.write(
            `  ${chalk.dim("Fields:")} ${provisioning.fields.join(", ")}\n`
          );
        }
      }

      if (dependencies) {
        process.stdout.write(
          `\n  ${chalk.cyan.bold("Dependencies")}\n`
        );
        if (dependencies.dependencies.length === 0) {
          process.stdout.write(`  ${chalk.dim("No dependencies")}\n`);
        } else {
          for (const dep of dependencies.dependencies) {
            process.stdout.write(`  • ${dep}\n`);
          }
        }
      }

      process.stdout.write("\n");
    } catch (error) {
      handleCommandError(error, spinner, "Failed to show product");
    }
  });
