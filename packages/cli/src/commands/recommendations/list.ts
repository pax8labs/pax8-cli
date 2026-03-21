import { Command } from "commander";
import chalk from "chalk";
import { createInterface } from "readline";
import { spawn } from "child_process";
import { getRecommendations, type Recommendation } from "@pax8/core";
import { buildContext, type CommandContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatCompanyName } from "../../lib/formatters.js";
import { enrichProductNames, enrichCompanyNames } from "../../lib/enrich-subscriptions.js";

const columns: Column[] = [
  {
    key: "_num",
    header: "#",
  },
  {
    key: "priority",
    header: "Priority",
    format: (v) => {
      const p = String(v);
      if (p === "high") return chalk.red.bold("HIGH");
      if (p === "medium") return chalk.yellow("MED");
      return chalk.dim("LOW");
    },
  },
  {
    key: "companyName",
    header: "Company",
    format: (v) => formatCompanyName(String(v)),
  },
  { key: "type", header: "Type", format: (v) => String(v) === "seat_gap" ? "Seat Gap" : "Cross-sell" },
  { key: "title", header: "Recommendation" },
  {
    key: "estimatedMrrUplift",
    header: "Est. MRR+",
    format: (v) => (v != null ? formatCurrency(v as number) : chalk.dim("—")),
  },
];

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function executeRecommendation(rec: Recommendation, ctx: CommandContext): Promise<void> {
  // Resolve names for preview
  let companyName = rec.companyName;
  let productName = rec.suggestedProducts[0] ?? "Unknown";

  process.stderr.write(chalk.bold(`\n  📦 Order Preview:\n\n`));
  process.stderr.write(`  ${chalk.dim("Company:")}  ${companyName}\n`);
  process.stderr.write(`  ${chalk.dim("Product:")}  ${rec.title}\n`);
  process.stderr.write(`  ${chalk.dim("Seats:")}    ${rec.targetSeats}\n`);
  if (rec.estimatedMrrUplift) {
    process.stderr.write(`  ${chalk.dim("Est. MRR:")} ${chalk.green("+" + formatCurrency(rec.estimatedMrrUplift) + "/mo")}\n`);
  }
  process.stderr.write("\n");

  // Ask for quantity (default to suggested)
  const qtyAnswer = await promptLine(
    `  Quantity? [${rec.targetSeats}] `
  );
  const quantity = qtyAnswer === "" ? rec.targetSeats! : parseInt(qtyAnswer, 10);
  if (isNaN(quantity) || quantity <= 0) {
    process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
    return;
  }

  // If no order command, run a product search to help the user find one
  if (!rec.orderCommand) {
    const searchTerm = rec.suggestedProducts?.[0] ?? productName;
    process.stderr.write(chalk.dim(`  Searching for "${searchTerm}"...\n\n`));
    await new Promise<void>((resolve) => {
      const child = spawn("pax8", ["products", "search", searchTerm], { stdio: "inherit", env: process.env });
      child.on("close", () => resolve());
    });
    return;
  }

  const companyMatch = rec.orderCommand.match(/--company\s+(\S+)/);
  const productMatch = rec.orderCommand.match(/--product\s+(\S+)/);
  if (!companyMatch || !productMatch) {
    process.stderr.write(chalk.red("  Could not parse order command.\n\n"));
    return;
  }

  const confirmAnswer = await promptLine(
    `  Place order for ${quantity} seats? [Y/n] `
  );
  if (confirmAnswer !== "" && !confirmAnswer.toLowerCase().startsWith("y")) {
    process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
    return;
  }

  const spinner = createSpinner("Creating order...").start();
  try {
    const order = await ctx.api.orders.create({
      companyId: companyMatch[1],
      lineItems: [{
        productId: productMatch[1],
        quantity,
        billingTerm: "Monthly",
      }],
    });
    spinner.succeed("Order created 🎉");
    process.stdout.write(`\n  Order ID: ${order.id}\n\n`);
  } catch (error) {
    spinner.fail("Order failed");
    const msg = error instanceof Error ? error.message : String(error);
    process.stderr.write(chalk.red(`  ${msg}\n\n`));
  }
}

export const recommendationsListCommand = new Command("list")
  .description("Analyze customer portfolios and recommend products")
  .option("--company <id|name>", "Filter to a specific company")
  .option("--priority <level>", "Filter by priority (high, medium, low)")
  .option("--type <type>", "Filter by type (seat_gap or cross_sell)")
  .option("--include-all", "Show all recommendations including ones without orderable products")
  .option("--limit <number>", "Max rows to show in table (default 10)")
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations list
  pax8 recommendations list --priority high
  pax8 recommendations list --company "Summit Healthcare"
  pax8 recommendations list --json`
  )
  .allowExcessArguments(true)
  .action(async (options, cmd) => {
    const allOpts = cmd.optsWithGlobals();

    // When the user forgets quotes (e.g. --company [DEMO] Client 52),
    // Commander only captures "[DEMO]" and the rest become excess args.
    // Rejoin them so the filter works as intended.
    if (options.company && cmd.args.length > 0) {
      options.company = [options.company, ...cmd.args].join(" ");
    }

    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Analyzing customer portfolios...").start();

    try {
      // Fetch subscriptions, companies, and enrich product names — all in parallel where possible
      const [subsResult, companiesResult] = await Promise.all([
        ctx.api.subscriptions.list({ size: 1000, status: "Active" }),
        ctx.api.companies.list({ size: 200 }),
      ]);

      // Build company name lookup
      const companyNames = new Map<string, string>();
      for (const c of companiesResult.content) {
        companyNames.set(c.id, c.name);
      }

      // Enrich subscriptions with product names (individual lookups, cached)
      const subs = subsResult.content;
      await enrichProductNames(ctx, subs);

      // Also enrich company names on subscriptions
      enrichCompanyNames(companyNames, subs);

      spinner.stop();

      // Fetch products for order command matching
      const productsResult = await ctx.api.products.list({ size: 200 });
      const report = getRecommendations(
        subs,
        productsResult.content,
      );

      let recs = report.recommendations;

      // Filter by company if specified (exact name, partial name/ID, or "contains" match)
      if (options.company) {
        const filter = options.company.toLowerCase();
        recs = recs.filter(
          (r) =>
            r.companyId === options.company ||
            r.companyId.startsWith(filter) ||
            r.companyName.toLowerCase() === filter ||
            r.companyName.toLowerCase() === `[demo] ${filter}` ||
            r.companyName.toLowerCase().includes(filter)
        );
      }

      // Filter by priority if specified
      if (options.priority) {
        recs = recs.filter((r) => r.priority === options.priority.toLowerCase());
      }

      // Filter by type if specified
      if (options.type) {
        recs = recs.filter((r) => r.type === options.type.toLowerCase());
      }

      if (ctx.outputFormat === "json") {
        output(recs, { format: "json" });
        return;
      }

      // In table mode, hide unavailable recs unless --include-all
      const unavailableCount = recs.filter((r) => !r.productAvailable).length;
      if (!options.includeAll) {
        recs = recs.filter((r) => r.productAvailable);
      }

      if (ctx.outputFormat === "quiet") return;

      if (ctx.outputFormat === "csv") {
        output(recs, { format: "csv", columns });
        return;
      }

      if (recs.length === 0) {
        if (unavailableCount > 0) {
          process.stderr.write(
            chalk.yellow(`\n  ${unavailableCount} gap${unavailableCount > 1 ? "s" : ""} found but the needed products aren't in your catalog yet.\n\n`) +
            chalk.dim("  Your customers could benefit from:\n")
          );
          // Show what categories are missing
          const missingCategories = new Set(report.recommendations.filter((r) => !r.productAvailable).map((r) => r.title.replace(/for .+$/, "").trim()));
          for (const cat of missingCategories) {
            process.stderr.write(chalk.dim(`    • ${cat}\n`));
          }
          process.stderr.write(chalk.dim(`\n  Ask your Pax8 rep to enable these product categories.\n`));
          process.stderr.write(chalk.dim(`  Use ${chalk.cyan("--include-all")} to see details.\n\n`));
        } else {
          process.stdout.write(
            chalk.green("\n  ✨ All customers look well-covered — nice work!\n\n")
          );
        }
        return;
      }

      // Number the recs for interactive selection, cap table output
      const limit = parseInt(options.limit, 10) || 10;
      const displayRecs = recs.slice(0, limit);
      const numbered = displayRecs.map((r, i) => ({ ...r, _num: String(i + 1) }));
      output(numbered, { format: "table", columns });

      // Summary footer
      const highCount = recs.filter((r) => r.priority === "high").length;
      const totalUplift = recs.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);
      const actionableCount = recs.filter((r) => r.orderCommand).length;

      if (recs.length > limit) {
        process.stderr.write(chalk.dim(`\n  Showing top ${limit} of ${recs.length} recommendations`) + chalk.dim(` · use --limit ${recs.length} to see all\n`));
      }

      const filteredCompanyCount = new Set(recs.map((r) => r.companyId)).size;
      process.stderr.write(
        chalk.dim(
          `\n  ${recs.length} recommendation${recs.length !== 1 ? "s" : ""} across ${filteredCompanyCount} ${filteredCompanyCount !== 1 ? "companies" : "company"}`
        )
      );

      if (highCount > 0) {
        process.stderr.write(chalk.red.bold(` — ${highCount} high priority`));
      }

      if (totalUplift > 0) {
        process.stderr.write(
          chalk.green(` — ${formatCurrency(totalUplift)}/mo potential MRR uplift`)
        );
      }

      process.stderr.write("\n");

      if (totalUplift >= 5000) {
        process.stderr.write(chalk.cyan(`\n  💰 That's ${formatCurrency(totalUplift * 12)}/yr waiting to be captured.\n`));
      } else if (totalUplift >= 1000) {
        process.stderr.write(chalk.cyan(`\n  📈 A few conversations could add ${formatCurrency(totalUplift * 12)}/yr to your book.\n`));
      }

      // Show actionable commands — copy-paste ready
      process.stderr.write(chalk.dim("\n  Quick actions:\n\n"));
      for (let i = 0; i < displayRecs.length; i++) {
        const rec = displayRecs[i];
        const product = rec.suggestedProducts?.[0] ?? "product";
        const seats = rec.targetSeats ?? "?";
        const uplift = rec.estimatedMrrUplift ? chalk.green(` +${formatCurrency(rec.estimatedMrrUplift)}/mo`) : "";
        process.stderr.write(`  ${chalk.cyan.bold(`${i + 1}.`)} ${product} for ${rec.companyName} (${seats} seats)${uplift}\n`);
        if (rec.orderCommand) {
          process.stderr.write(chalk.dim(`     ${rec.orderCommand}\n\n`));
        }
      }

      if (unavailableCount > 0) {
        process.stderr.write(chalk.dim(`\n  ${unavailableCount} more recommendation${unavailableCount > 1 ? "s" : ""} hidden — no orderable products in catalog yet\n`));
      }

      // Save pending actions for REPL mode
      try {
        const { writeFileSync, mkdirSync } = await import("fs");
        const { homedir } = await import("os");
        const { join } = await import("path");
        const dir = join(homedir(), ".pax8");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "pending-actions.json"), JSON.stringify(
          displayRecs.map((r, i) => ({
            key: String(i + 1),
            rec: { companyId: r.companyId, companyName: r.companyName, title: r.title, orderCommand: r.orderCommand, suggestedProducts: r.suggestedProducts, targetSeats: r.targetSeats },
          }))
        ));
      } catch { /* best effort */ }

      // Interactive prompt (non-REPL only)
      if (process.stdin.isTTY && process.env.PAX8_REPL !== "1") {
        const answer = await promptLine(
          `\n  ${chalk.bold("Enter #")} to act, or press Enter to skip: `
        );
        if (answer !== "") {
          const idx = parseInt(answer, 10) - 1;
          if (idx >= 0 && idx < displayRecs.length) {
            await executeRecommendation(displayRecs[idx], ctx);
          } else {
            process.stderr.write(chalk.yellow(`  Invalid selection.\n\n`));
          }
        } else {
          process.stderr.write("\n");
        }
      } else {
        process.stderr.write("\n");
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to generate recommendations");
    }
  });
