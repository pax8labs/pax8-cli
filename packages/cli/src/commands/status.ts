import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../lib/context.js";
import { createSpinner } from "../lib/spinner.js";
import { handleCommandError } from "../lib/errors.js";
import { formatCurrency } from "../lib/formatters.js";
import { promptNextSteps } from "../lib/next-step.js";

export const statusCommand = new Command("status")
  .description("Quick snapshot of your Pax8 business")
  .addHelpText("after", `
Examples:
  pax8 status
  pax8 status --json`)
  .action(async (_options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Loading dashboard...").start();

    try {
      const [companiesResult, subsResult] = await Promise.all([
        ctx.api.companies.list({ size: 1 }),
        ctx.api.subscriptions.list({ size: 1000, status: "Active" }),
      ]);

      // Compute MRR
      let mrr = 0;
      let totalSeats = 0;
      const companyIds = new Set<string>();
      for (const sub of subsResult.content) {
        const price = (sub as Record<string, unknown>).price as number ?? 0;
        const qty = (sub as Record<string, unknown>).quantity as number ?? 0;
        const term = String((sub as Record<string, unknown>).billingTerm ?? "Monthly");
        mrr += term.toLowerCase().includes("annual") ? (price * qty) / 12 : price * qty;
        totalSeats += qty;
        companyIds.add(String((sub as Record<string, unknown>).companyId));
      }

      spinner.stop();

      if (ctx.outputFormat === "json") {
        process.stdout.write(JSON.stringify({
          totalCompanies: companiesResult.page.totalElements,
          activeSubscriptions: subsResult.content.length,
          companiesWithActiveSubs: companyIds.size,
          totalSeats,
          mrr: Number(mrr.toFixed(2)),
          arr: Number((mrr * 12).toFixed(2)),
        }, null, 2) + "\n");
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      const arr = mrr * 12;

      process.stdout.write("\n");
      process.stdout.write(chalk.bold("  📊 Pax8 Business Snapshot\n\n"));
      process.stdout.write(`  ${chalk.cyan.bold(formatCurrency(mrr))}/mo MRR  ·  ${chalk.cyan.bold(formatCurrency(arr))}/yr ARR\n\n`);
      process.stdout.write(`  ${chalk.dim("Companies:")}     ${companiesResult.page.totalElements}\n`);
      process.stdout.write(`  ${chalk.dim("Active subs:")}   ${subsResult.content.length} across ${companyIds.size} companies\n`);
      process.stdout.write(`  ${chalk.dim("Total seats:")}   ${totalSeats.toLocaleString()}\n`);

      // Average MRR per company
      if (companyIds.size > 0) {
        const avgMrr = mrr / companyIds.size;
        process.stdout.write(`  ${chalk.dim("Avg MRR/co:")}    ${formatCurrency(avgMrr)}\n`);
      }

      // Quick health indicators
      process.stdout.write("\n");
      if (mrr > 0) {
        const seatValue = mrr / totalSeats;
        process.stdout.write(`  ${chalk.dim("Avg seat value:")} ${formatCurrency(seatValue)}/mo\n`);
      }

      process.stdout.write("\n");

      await promptNextSteps([
        { key: "1", label: "View customers", command: ["pax8", "companies", "list"] },
        { key: "2", label: "Find growth opportunities", command: ["pax8", "recommendations", "list", "--priority", "high"] },
        { key: "3", label: "Check upcoming renewals", command: ["pax8", "subscriptions", "renewals"] },
      ]);
    } catch (error) {
      handleCommandError(error, spinner, "Failed to load status");
    }
  });
