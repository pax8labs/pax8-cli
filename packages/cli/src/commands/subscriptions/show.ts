// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import {
  formatStatus,
  formatCurrency,
  formatCurrencyNullable,
  formatDate,
  formatQuantity,
} from "../../lib/formatters.js";
import { enrichProductNames } from "../../lib/enrich-subscriptions.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";

const historyColumns: Column[] = [
  { key: "date", header: "Date", format: (v) => formatDate(String(v)) },
  { key: "field", header: "Field" },
  { key: "oldValue", header: "Old Value" },
  { key: "newValue", header: "New Value" },
];

export const subscriptionsShowCommand = new Command("show")
  .description("Show subscription details")
  .argument("<id>", "Subscription ID")
  .option("--history", "Show subscription change history")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions show sub-summit-m365bp-001
  pax8 subscriptions show sub-summit-m365bp-001 --history
  pax8 subscriptions show sub-summit-m365bp-001 --json

Note: the \`provisioningStatus\` field reflects the subscription's
coarse-grained provisioning state as reported by the Pax8 API (e.g.
Provisioned, Pending, Failed). It does not expose internal task-level
provisioning detail.`
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching subscription...").start();

    try {
      const sub = await ctx.api.subscriptions.get(id);

      // Enrich product and company names
      await enrichProductNames(ctx, [sub as unknown as Record<string, unknown>]);
      if (!sub.companyName) {
        try {
          const company = await ctx.api.companies.get(sub.companyId);
          (sub as Record<string, unknown>).companyName = company.name;
        } catch { /* best effort */ }
      }

      spinner.stop();

      if (ctx.outputFormat === "json") {
        if (options.history) {
          const history = await ctx.api.subscriptions.getHistory(id);
          const changes = Array.isArray(history) ? history : history.changes;
          process.stdout.write(
            JSON.stringify({ ...sub, history: changes }, null, 2) + "\n"
          );
        } else {
          process.stdout.write(JSON.stringify(sub, null, 2) + "\n");
        }
        return;
      }

      if (ctx.outputFormat === "csv") {
        output([sub], { format: "csv" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // Table format: key-value display
      process.stdout.write("\n");
      // Append the ISO-4217 currency code only when it isn't USD. Common
      // case stays unchanged; non-USD partners get e.g. `$1,234.56 EUR`.
      // Surfaced in #273 (fixes #6).
      const currencyCode = (sub as { currencyCode?: string }).currencyCode ?? "USD";
      // #657 / UXR F9: use the null-aware helper so a missing `price`
      // renders as `—` instead of the ambiguous `$0.00`. Label renamed
      // to `Partner Price` to match the wire semantic (what the partner
      // pays Pax8) and the `products show --pricing` column.
      const priceFormatted =
        sub.price == null
          ? formatCurrencyNullable(null)
          : currencyCode === "USD"
            ? formatCurrency(sub.price)
            : `${formatCurrency(sub.price)} ${currencyCode}`;
      const fields: [string, string][] = [
        ["ID", sub.id],
        ["Company", sub.companyName ?? sub.companyId],
        ["Product", sub.productName ?? ""],
        ["Quantity", formatQuantity(sub.quantity)],
        ["Status", formatStatus(sub.status)],
        ["Partner Price", priceFormatted],
        ["Billing Term", sub.billingTerm ?? ""],
        ["Start Date", formatDate(sub.startDate)],
        // #385: read canonical `createdAt`. Legacy `createdDate` is still
        // dual-emitted on `--json` for back-compat; removal in v0.3.0.
        ["Created", formatDate(sub.createdAt)],
        ["Provisioning", (sub as { provisioningStatus?: string }).provisioningStatus ?? ""],
      ];

      if (sub.commitmentTermEndDate) {
        fields.push(["Term End", formatDate(sub.commitmentTermEndDate)]);
      }

      for (const [label, value] of fields) {
        process.stdout.write(
          `  ${chalk.dim((label + ":").padEnd(18))}${value}\n`
        );
      }
      process.stdout.write("\n");

      // Show history if requested
      if (options.history) {
        const history = await ctx.api.subscriptions.getHistory(id);
        const changes = Array.isArray(history) ? history : history.changes;
        if (changes.length > 0) {
          process.stdout.write(chalk.bold("  Change History\n\n"));
          output(changes, {
            format: "table",
            columns: historyColumns,
          });
          process.stdout.write("\n");
        } else {
          process.stdout.write(chalk.dim("  No change history.\n\n"));
        }
      }

      // Pickable next steps. The `subscriptions update --quantity <n>` action
      // is intentionally omitted from the pickable list — it needs a value
      // the user has to choose, so it can't be drilled into by number.
      // Surfaced as an affordance pointer below the list instead.
      if (ctx.outputFormat === "table") {
        const companyLabel = sub.companyName ?? sub.companyId;
        const steps: NextStep[] = [];
        let n = 1;
        if (!options.history) {
          steps.push({
            key: String(n++),
            label: `${chalk.cyan(replCmd(`pax8 subscriptions show ${id} --history`))}  ${chalk.dim("view change history")}`,
            command: ["subscriptions", "show", id, "--history"],
          });
        }
        steps.push({
          key: String(n++),
          label: `${chalk.cyan(replCmd(`pax8 clients more "${companyLabel}"`))}  ${chalk.dim("view client")}`,
          command: ["clients", "more", String(companyLabel)],
        });
        steps.push({
          key: String(n++),
          label: `${chalk.cyan(replCmd(`pax8 subscriptions cancel ${id}`))}  ${chalk.dim("cancel this subscription")}`,
          command: ["subscriptions", "cancel", id],
        });
        process.stderr.write(chalk.dim("  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
        process.stderr.write(
          chalk.dim(
            `  You can also adjust quantity or billing term — run ${chalk.cyan(replCmd("pax8 subscriptions update --help"))} for syntax.\n\n`,
          ),
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to show subscription");
    }
  });
