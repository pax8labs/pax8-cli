// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ApiError, ERROR_API_VALIDATION, ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { confirmDestructive } from "../../lib/confirm.js";
import { formatCurrency, formatQuantity, calculateMrr } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import { markWriteInFlight } from "../../lib/signals.js";

/**
 * Active-commitment summary for the preview block. `null` when the sub has
 * no commitment or the commitment endDate is in the past.
 */
function summarizeActiveCommitment(
  commitmentEndIso: string | null | undefined,
  now: Date = new Date(),
): { endIso: string; daysRemaining: number; monthsRemaining: number } | null {
  if (!commitmentEndIso) return null;
  const endDate = new Date(`${commitmentEndIso}T23:59:59Z`);
  if (Number.isNaN(endDate.getTime())) return null;
  const msRemaining = endDate.getTime() - now.getTime();
  if (msRemaining <= 0) return null;
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));
  // Whole months, rounded UP — partial months still incur full billing per the
  // Pax8 TOS ("all fees paid are nonrefundable"). Underestimating would
  // mislead partners about the cost-through-term-end.
  const monthsRemaining = Math.max(1, Math.ceil(daysRemaining / 30));
  return { endIso: commitmentEndIso, daysRemaining, monthsRemaining };
}

/**
 * Validate a `YYYY-MM-DD` cancel date. Returns the normalized string on
 * success, throws a `CliError(ERROR_INVALID_INPUT)` with recovery hints on
 * failure.
 *
 * Surface-shape note (#333): we accept the simple ISO calendar form only on
 * the CLI surface so partner scripts keep working. The Pax8 OpenAPI spec
 * types the underlying `cancelDate` query parameter as `format: date-time`
 * (RFC 3339, e.g. `2026-12-31T00:00:00Z`); `SubscriptionsApi.delete()`
 * normalizes the date-only form to `YYYY-MM-DDT00:00:00Z` before the wire
 * call, matching the spec without forcing partners to pass timestamps.
 */
function parseCancelDate(raw: string): string {
  const trimmed = raw.trim();
  // Strict YYYY-MM-DD shape so "2026-1-1" and "1/15/2026" don't sneak through.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new CliError(
      `Invalid --cancel-date "${raw}".`,
      ["Expected ISO calendar form YYYY-MM-DD (e.g. 2026-12-31)."],
      [
        `Pass the date as YYYY-MM-DD: ${chalk.cyan(replCmd("pax8 subscriptions cancel <id> --cancel-date 2026-12-31"))}`,
        "Omit --cancel-date for an immediate cancellation.",
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  // Reject calendar-impossible values (Feb 30, month 13, etc.) — the regex
  // above is a shape check, this is the round-trip semantic check.
  const parsed = new Date(`${trimmed}T00:00:00Z`);
  const reserialized = Number.isNaN(parsed.getTime())
    ? null
    : parsed.toISOString().slice(0, 10);
  if (reserialized !== trimmed) {
    throw new CliError(
      `Invalid --cancel-date "${raw}".`,
      ["The value parses as a calendar-impossible date."],
      [
        `Pass a real calendar date as YYYY-MM-DD: ${chalk.cyan(replCmd("pax8 subscriptions cancel <id> --cancel-date 2026-12-31"))}`,
      ],
      undefined,
      ERROR_INVALID_INPUT,
    );
  }
  return trimmed;
}

export const subscriptionsCancelCommand = new Command("cancel")
  .description("Cancel a subscription")
  .argument("<id>", "Subscription ID")
  .option("--cancel-date <YYYY-MM-DD>", "Schedule cancellation for a future date (ISO YYYY-MM-DD)")
  .option(
    "--immediately",
    "Cancel today (overrides the default safe-path of scheduling for the commitment term end date on committed subscriptions). Without this flag, committed subs default to cancellation at the commitment term end date.",
  )
  .option("-y, --yes", "Skip confirmation prompts")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions cancel sub-summit-m365bp-001
  pax8 subscriptions cancel sub-summit-m365bp-001 --yes
  pax8 subscriptions cancel sub-summit-m365bp-001 --immediately --yes
  pax8 subscriptions cancel sub-summit-m365bp-001 --cancel-date 2026-12-31

Behavior on committed subscriptions:
  When the subscription has an active commitment term, cancellation defaults
  to the commitment term end date — the canonical Pax8 safe path. Cancelling
  before the commitment term end date will not stop billing: per the Pax8
  Direct User Agreement, fees paid for the unused portion of the term are
  nonrefundable. Use --immediately to make a cancel-today intent explicit, or
  --cancel-date <YYYY-MM-DD> to schedule a different date.

  Vendor-specific cancellation rules (Microsoft NCE 7-day window, Adobe
  renewal-only window, Azure Savings Plan finality, etc.) are governed by
  Pax8 marketplace policy and the vendor; see the Pax8 portal for
  vendor-coordinated cancellation flows when the API rejects.`,
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    let companyName: string | undefined;
    let productName: string | undefined;

    try {
      const explicitCancelDate = allOpts.cancelDate
        ? parseCancelDate(String(allOpts.cancelDate))
        : undefined;
      const cancelImmediately = !!allOpts.immediately;

      // Fetch subscription details to inspect commitment context + show preview
      const spinner = createSpinner("Fetching subscription...").start();
      const sub = await ctx.api.subscriptions.get(id);
      spinner.stop();

      companyName = sub.companyName ?? sub.companyId;
      productName = sub.productName ?? sub.productId;

      const commitmentEndIso =
        sub.commitment?.endDate ?? sub.commitmentTermEndDate ?? null;
      const activeCommitment = summarizeActiveCommitment(commitmentEndIso);

      // Effective cancel-date resolution:
      //   1. --cancel-date wins (explicit user override, existing #256 contract)
      //   2. --immediately forces cancel-today (overrides commitment-aware default)
      //   3. Active commitment + no flag → default to commitment term end date
      //      (the canonical Pax8 safe path)
      //   4. No commitment / past commitment → cancel today (existing behavior)
      let effectiveCancelDate: string | undefined;
      let usedSafePath = false;
      if (explicitCancelDate) {
        effectiveCancelDate = explicitCancelDate;
      } else if (cancelImmediately) {
        effectiveCancelDate = undefined;
      } else if (activeCommitment) {
        effectiveCancelDate = activeCommitment.endIso;
        usedSafePath = true;
      } else {
        effectiveCancelDate = undefined;
      }

      const mrr = calculateMrr(
        sub.price ?? 0,
        sub.quantity,
        String(sub.billingTerm ?? "Monthly"),
      );

      if (ctx.outputFormat === "table") {
        // Commitment-aware preview block. Vocabulary follows Pax8 canonical
        // phrasing: "commitment term end date" (not "renewal date" — they
        // can differ); "Cancelling now will not stop billing" (Pax8 has no
        // early-termination fee per the Direct User Agreement — the
        // consequence is "fees paid are nonrefundable", i.e. billing
        // continues, not a separate penalty). See the canonical Rovo
        // research grounding for #294.
        //
        // Both branches print BEFORE the confirmation prompt so the partner
        // sees the full picture (committed vs uncommitted) before they
        // commit to the cancellation. Pre-#409 the uncommitted case fell
        // straight through to the destructive preview with no narrative
        // about timing — partners cancelling a Monthly sub had no
        // pre-flight signal that cancellation would take effect immediately.
        if (activeCommitment) {
          const estimatedCost =
            (sub.price ?? 0) * sub.quantity * activeCommitment.monthsRemaining;
          process.stdout.write(chalk.yellow.bold("\n  ⚠ COMMITMENT ACTIVE\n\n"));
          process.stdout.write(
            chalk.bold(
              `  This subscription has an active commitment ending ${activeCommitment.endIso}.\n\n`,
            ),
          );
          process.stdout.write(
            `  ${chalk.bold("Product")}            ${productName}\n`,
          );
          process.stdout.write(
            `  ${chalk.bold("Commitment term")}    ${sub.commitment?.term ?? "—"} (ends ${activeCommitment.endIso})\n`,
          );
          process.stdout.write(
            `  ${chalk.bold("Days remaining")}     ${activeCommitment.daysRemaining}\n`,
          );
          process.stdout.write(
            `  ${chalk.bold("Estimated cost through term end")}   ${formatCurrency(estimatedCost)}\n`,
          );
          process.stdout.write(
            chalk.dim(
              "    (price × quantity × remaining months — estimated, not guaranteed)\n\n",
            ),
          );
          if (cancelImmediately) {
            process.stdout.write(
              chalk.yellow(
                `  --immediately: cancelling today. Cancelling now will not stop billing\n  for the remaining commitment term through ${activeCommitment.endIso}.\n\n`,
              ),
            );
          } else if (explicitCancelDate && explicitCancelDate < activeCommitment.endIso) {
            process.stdout.write(
              chalk.yellow(
                `  --cancel-date ${explicitCancelDate} is before the commitment term end date.\n  Cancelling on that date will not stop billing for the remaining commitment\n  term through ${activeCommitment.endIso}.\n\n`,
              ),
            );
          } else {
            process.stdout.write(
              chalk.dim(
                `  By default cancellation will take effect on the commitment term end date.\n  Use --immediately to cancel today, or --cancel-date <YYYY-MM-DD> to schedule a different date.\n\n`,
              ),
            );
          }
        } else if (!explicitCancelDate) {
          // Uncommitted-sub preview (#409 finding #7). The committed branch
          // above is loud (yellow + ⚠ + estimated cost). For uncommitted
          // subs the framing is the inverse: the partner needs to know
          // that cancellation will NOT wait for any term end — it takes
          // effect immediately. Stays dim because there's no commitment
          // protection to surface, but the headline is still explicit so
          // a Monthly-sub partner doesn't conflate this with the safe-path
          // default they see in the help text.
          //
          // Only render when there's no `--cancel-date` override; an
          // explicit future date already prints below via the standard
          // preview block's `Cancel Date` row, so duplicating "takes
          // effect immediately" here would be misleading.
          process.stdout.write(
            chalk.dim(
              "\n  This subscription has no active commitment. Cancellation will take effect immediately.\n\n",
            ),
          );
        }

        const heading = effectiveCancelDate
          ? `  Subscription to be cancelled on ${effectiveCancelDate}:\n\n`
          : "  Subscription to be cancelled:\n\n";
        process.stdout.write(chalk.red.bold(heading));
        process.stdout.write(`  ${chalk.bold("Company")}      ${sub.companyName ?? sub.companyId}\n`);
        process.stdout.write(`  ${chalk.bold("Product")}      ${productName}\n`);
        process.stdout.write(`  ${chalk.bold("Quantity")}     ${formatQuantity(sub.quantity)}\n`);
        if (effectiveCancelDate) {
          process.stdout.write(
            `  ${chalk.bold("Cancel Date")}  ${effectiveCancelDate}${usedSafePath ? chalk.dim(" (commitment term end)") : ""}\n`,
          );
        }
        process.stdout.write(`  ${chalk.bold("Est. MRR Impact")}   ${chalk.red("-" + formatCurrency(mrr))}\n`);
        process.stdout.write("\n");
      }

      // Destructive confirmation — surface the scheduled date so the user
      // doesn't conflate scheduled with immediate cancellation.
      const confirmMessage = effectiveCancelDate
        ? `This will schedule cancellation for ${effectiveCancelDate}. This action cannot be undone.`
        : "This action cannot be undone.";
      const confirmed = await confirmDestructive(confirmMessage, "cancel");

      if (!confirmed) {
        process.stderr.write(chalk.yellow("\n  Cancellation aborted.\n\n"));
        return;
      }

      const cancelSpinner = createSpinner(
        effectiveCancelDate
          ? `Scheduling cancellation for ${effectiveCancelDate}...`
          : "Cancelling subscription...",
      ).start();
      const doneCancel = markWriteInFlight("subscriptions");
      try {
        await ctx.api.subscriptions.delete(
          id,
          effectiveCancelDate ? { cancelDate: effectiveCancelDate } : undefined,
        );
      } finally {
        doneCancel();
      }
      await invalidateCacheAfterWrite();
      cancelSpinner.succeed(
        effectiveCancelDate
          ? `Cancellation scheduled for ${effectiveCancelDate}`
          : "Subscription cancelled",
      );

      if (ctx.outputFormat === "json") {
        output(
          [
            effectiveCancelDate
              ? { id: sub.id, status: "Cancelled", cancelDate: effectiveCancelDate }
              : { id: sub.id, status: "Cancelled" },
          ],
          { format: "json" },
        );
      }

      // Pickable next steps. `orders create --product <name>` is the
      // natural follow-on (order a replacement) but it needs the product
      // name from the user, so it can't be drilled into by number —
      // surfaced as an affordance pointer below.
      const coName = sub.companyName ?? sub.companyId;
      const steps: NextStep[] = [
        {
          key: "1",
          label: `${chalk.cyan(replCmd(`pax8 subscriptions list --company "${coName}"`))}  ${chalk.dim("remaining subscriptions")}`,
          command: ["subscriptions", "list", "--company", String(coName)],
        },
        {
          key: "2",
          label: `${chalk.cyan(replCmd(`pax8 clients more "${coName}"`))}  ${chalk.dim("view client summary")}`,
          command: ["clients", "more", String(coName)],
        },
      ];
      process.stderr.write(chalk.dim("\n  Try next:\n"));
      await promptNextSteps(steps, { renderList: true });
      process.stderr.write(
        chalk.dim(
          `  Order a replacement — run ${chalk.cyan(replCmd("pax8 orders create --help"))} for syntax.\n\n`,
        ),
      );
    } catch (error) {
      // Wrap API rejections (vendor-specific commitment enforcement: NCE
      // 7-day window, Adobe renewal-only window, Azure Savings Plan
      // finality, vendor-coordinated cancellations like Sophos / INKY)
      // with an actionable message that points partners at the portal.
      // Per Rovo research, the cancel API returns 204/404 with no
      // structured body — pattern-matching the error string is fragile,
      // so the wrapper is generic.
      if (error instanceof ApiError && error.statusCode !== 404) {
        const display = productName
          ? `"${productName}"${companyName ? ` for ${companyName}` : ""}`
          : "subscription";
        await handleCommandError(
          new CliError(
            `Pax8 marketplace rejected the cancellation of ${display}`,
            [
              "This may be vendor-specific commitment enforcement",
              "Some vendors block mid-commitment cancellation entirely (e.g., Microsoft NCE outside the 7-day window, Adobe outside the 14-day renewal window, Azure Savings Plans)",
            ],
            [
              `Run ${replCmd("pax8 subscriptions show")} ${id} to see the commitment term`,
              "Use --cancel-date <YYYY-MM-DD> to schedule cancellation for the commitment term end date",
              "Use the Pax8 portal for vendor-coordinated cancellation flows",
            ],
            undefined,
            ERROR_API_VALIDATION,
          ),
        );
      }
      await handleCommandError(error, undefined, "Failed to cancel subscription");
    }
  });
