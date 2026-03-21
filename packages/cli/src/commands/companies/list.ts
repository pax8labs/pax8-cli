import { Command } from "commander";
import chalk from "chalk";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { formatStatus, formatCompanyName } from "../../lib/formatters.js";
import { saveLastList } from "../../lib/last-list.js";
import { createInterface } from "readline";
import { spawn } from "child_process";

const columns: Column[] = [
  { key: "_num", header: "#" },
  { key: "name", header: "Name", format: (v) => formatCompanyName(String(v), 30) },
  { key: "id", header: "ID", format: (v) => chalk.dim(String(v).slice(0, 8)) },
  { key: "status", header: "Status", format: (v) => formatStatus(String(v)) },
];

export const companiesListCommand = new Command("list")
  .description("List all companies")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", "Page size", "25")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 companies list
  pax8 companies list --page 1 --size 25
  pax8 companies list --json
  pax8 companies list --csv
  pax8 companies list --ids-only
  pax8 companies list --ids-only | xargs -I{} pax8 subscriptions list --company {}`
  )
  .action(async (options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const spinner = createSpinner("Fetching companies...").start();

    try {
      const ctx = await buildContext(allOpts);
      const userPage = parseInt(allOpts.page, 10);
      const pageSize = parseInt(allOpts.size, 10);
      const apiPage = Math.max(userPage - 1, 0); // User sees 1-based, API is 0-based
      const result = await ctx.api.companies.list({
        page: apiPage,
        size: pageSize,
      });

      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      // Row numbers continue across pages (page 2 starts at 26, not 1)
      const startNum = apiPage * pageSize;
      const numbered = result.content.map((c: Record<string, unknown>, i: number) => ({
        ...c,
        _num: String(startNum + i + 1),
      }));

      await saveLastList(
        result.content.map((c: Record<string, unknown>, i: number) => ({
          index: startNum + i + 1,
          id: String(c.id),
          name: String(c.name),
        }))
      );

      output(numbered, { format: ctx.outputFormat, columns });

      if (ctx.outputFormat === "table") {
        const currentPage = result.page.number; // 0-based from API
        const totalPages = result.page.totalPages;
        const totalElements = result.page.totalElements;

        let pageInfo = `${totalElements} companies`;
        if (totalPages > 1) {
          pageInfo += ` · page ${currentPage + 1}/${totalPages}`;
        }
        process.stderr.write(chalk.dim(`\n  ${pageInfo}\n`));

        if (totalPages > 1 && currentPage < totalPages - 1) {
          process.stderr.write(
            chalk.dim("  Next page: ") + chalk.cyan(`pax8 companies list --page ${currentPage + 2}`) + "\n"
          );
        }

        // Interactive: pick a company to drill into
        if (process.stdin.isTTY && process.env.PAX8_REPL !== "1") {
          const rl = createInterface({ input: process.stdin, output: process.stderr });
          const answer = await new Promise<string>((resolve) => {
            rl.question(chalk.dim(`\n  Enter # to view details, or press Enter to skip: `), (a) => {
              rl.close();
              resolve(a.trim());
            });
          });

          if (answer !== "") {
            const idx = parseInt(answer, 10);
            if (idx >= 1 && idx <= result.content.length) {
              process.stderr.write("\n");
              await new Promise<void>((resolve) => {
                const child = spawn("pax8", ["companies", "more", String(idx)], { stdio: "inherit", env: process.env });
                child.on("close", () => resolve());
              });
              return;
            }
          }
          process.stderr.write("\n");
        }
      }
    } catch (error) {
      handleCommandError(error, spinner, "Failed to list companies");
    }
  });
