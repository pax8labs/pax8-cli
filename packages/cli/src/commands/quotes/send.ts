// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { formatCurrency } from "../../lib/formatters.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import type { Quote } from "@pax8/core";

/**
 * Find a customer-facing link in the post-send response. The Pax8 v2 quoting
 * spec doesn't currently document a top-level `customerLink` / `publicUrl`
 * field — partners typically receive the link via email — but if the API ever
 * begins returning one we'll surface it without a release. Probes a small
 * allow-list of likely keys; if nothing matches, callers fall back to the
 * "delivered via email" hint.
 */
function findCustomerLink(quote: Quote): string | undefined {
  const candidates = [
    "customerLink",
    "publicUrl",
    "shareUrl",
    "url",
    "quoteUrl",
  ] as const;
  const raw = quote as unknown as Record<string, unknown>;
  for (const key of candidates) {
    const value = raw[key];
    if (typeof value === "string" && /^https?:\/\//.test(value)) {
      return value;
    }
  }
  return undefined;
}

function quoteTotal(q: Quote): number {
  return (q.lineItems ?? []).reduce(
    (s, li) => s + (li.subtotal ?? (li.unitPrice ?? 0) * li.quantity),
    0,
  );
}

export const quotesSendCommand = new Command("send")
  .description("Send a quote to the customer (transitions status to Sent)")
  .argument("<quote-id>", "Quote ID")
  .option("-y, --yes", "Skip confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 quotes send quote-bright-001
  pax8 quotes send quote-bright-001 --yes
  pax8 quotes send quote-bright-001 --json --yes

Note:
  Sending publishes the quote to the customer. Pax8 emails the customer-facing
  link automatically; if the API response includes a direct link it is shown
  here as well. The customer-side accept/decline triggers a QUOTE.Accepted
  webhook that downstream automation can act on.`,
  )
  .action(async (quoteId, _options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);

    try {
      const fetchSpinner = createSpinner("Fetching quote...").start();
      const quote = await ctx.api.quotes.get(quoteId);
      fetchSpinner.stop();

      const lineCount = quote.lineItems?.length ?? 0;
      const total = quoteTotal(quote);

      process.stderr.write(chalk.bold("\n  Send quote to customer:\n\n"));
      process.stderr.write(`  ${chalk.dim("Quote:".padEnd(18))}${quote.id}\n`);
      process.stderr.write(`  ${chalk.dim("Current status:".padEnd(18))}${quote.status}\n`);
      process.stderr.write(`  ${chalk.dim("Line items:".padEnd(18))}${lineCount}\n`);
      if (lineCount > 0) {
        process.stderr.write(`  ${chalk.dim("Total:".padEnd(18))}${formatCurrency(total)}\n`);
      }
      process.stderr.write(
        `\n  ${chalk.yellow("This is a customer-visible action — the customer will receive a quote link.")}\n\n`,
      );

      const ok = await confirm("Send this quote?", { default: false });
      if (!ok) {
        process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        return;
      }

      const spinner = createSpinner("Sending quote...").start();
      const done = markWriteInFlight("quotes");
      let updated;
      try {
        updated = await ctx.api.quotes.send(quoteId);
      } finally {
        done();
      }
      await invalidateCacheAfterWrite();
      spinner.succeed("Quote sent");

      if (ctx.outputFormat === "json") {
        output([updated], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      const link = findCustomerLink(updated as Quote);
      const reference = (updated as unknown as Record<string, unknown>).referenceCode;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.green("✓")} Quote sent.\n`);
      if (link) {
        process.stdout.write(`  ${chalk.dim("Customer link:".padEnd(18))}${chalk.cyan(link)}\n`);
      } else {
        process.stdout.write(
          `  ${chalk.dim("The customer will receive the quote link by email.")}\n`,
        );
      }
      if (typeof reference === "string" && reference.length > 0) {
        process.stdout.write(`  ${chalk.dim("Reference:".padEnd(18))}${reference}\n`);
      }
      process.stdout.write("\n");

      // Pickable next steps. The natural follow-on after `send` is to
      // re-check the quote for the customer response and to surface the
      // owning client. `webhooks list` (verify QUOTE.Accepted subscribers)
      // is real-but-tangential — kept as an affordance pointer below
      // rather than a pickable step the partner is unlikely to choose in
      // this moment.
      const companyId = (updated as Quote).companyId;
      // #481: prefer the resolved client name when available (the v2
      // quoting API populates `client.name`, flattened to `clientName`
      // by QuoteSchema's preprocess step). Falls back to the UUID for
      // shadow companies / partner-side records without a display name.
      const clientName = (updated as Quote).clientName;
      const steps: NextStep[] = [
        {
          key: "1",
          label: `${chalk.cyan(replCmd(`pax8 quotes show ${updated.id}`))}  ${chalk.dim("view the live quote (check responses)")}`,
          command: ["quotes", "show", String(updated.id)],
        },
      ];
      if (companyId) {
        steps.push({
          key: "2",
          label: `${chalk.cyan(replCmd(`pax8 clients more "${clientName ?? companyId}"`))}  ${chalk.dim("view client")}`,
          command: ["clients", "more", companyId],
        });
      }
      process.stderr.write(chalk.dim("  Try next:\n"));
      await promptNextSteps(steps, { renderList: true });
      process.stderr.write(
        chalk.dim(
          `  Verify QUOTE.Accepted webhook delivery — run ${chalk.cyan(replCmd("pax8 webhooks list"))} to inspect subscribers.\n\n`,
        ),
      );
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to send quote");
    }
  });
