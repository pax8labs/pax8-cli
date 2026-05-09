// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError, extractErrorDetail } from "../../lib/errors.js";
import { confirmWithChange, replCmd } from "../../lib/confirm.js";
import { formatQuantity, formatCurrency, formatStatus } from "../../lib/formatters.js";
import { invalidateCacheAfterWrite } from "../../lib/invalidate-cache.js";
import { markWriteInFlight } from "../../lib/signals.js";
import { ApiError, ERROR_API_VALIDATION } from "@pax8/core";
import type { Subscription } from "@pax8/core";

/**
 * Format an ISO date string for human display (e.g. "2026-05-11").
 * Falls back to the raw value if parsing fails.
 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/**
 * Whole-day delta from `now` until `iso`. Returns 0 for past or same-day.
 */
function daysUntil(iso: string, now: Date = new Date()): number {
  const target = new Date(iso);
  if (isNaN(target.getTime())) return 0;
  const ms = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Decide whether the subscription is mid-commitment. Returns the endDate when
 * the commitment is active (in the future), otherwise `null`.
 *
 * The Pax8 marketplace API treats absent / past `commitment.endDate` as
 * "monthly billing or post-commitment" — those subs accept arbitrary updates,
 * so we let the API handle them as before. Only active commitments need
 * pre-flight protection.
 */
function activeCommitmentEndDate(sub: Subscription): string | null {
  const endDate = sub.commitment?.endDate ?? sub.commitmentTermEndDate ?? null;
  if (!endDate) return null;
  const parsed = new Date(endDate);
  if (isNaN(parsed.getTime())) return null;
  if (parsed.getTime() <= Date.now()) return null;
  return endDate;
}

export const subscriptionsUpdateCommand = new Command("update")
  .description("Update a subscription")
  .argument("<id>", "Subscription ID")
  .option("--quantity <number>", "New quantity")
  .option("--billing-term <term>", "New billing term (Monthly or Annual)")
  .option("-y, --yes", "Skip confirmation prompts")
  .addHelpText(
    "after",
    `
Examples:
  pax8 subscriptions update sub-summit-m365bp-001 --quantity 50
  pax8 subscriptions update sub-summit-m365bp-001 --billing-term Annual
  pax8 subscriptions update sub-summit-m365bp-001 --quantity 30 --yes`
  )
  .action(async (id, options, cmd) => {
    const allOpts = cmd.optsWithGlobals();
    const ctx = await buildContext(allOpts);

    try {
      // First, fetch the current subscription
      const spinner = createSpinner("Fetching subscription...").start();
      const sub = await ctx.api.subscriptions.get(id);
      spinner.stop();

      // ── Commitment-aware pre-flight ────────────────────────────────────────
      //
      // The Pax8 marketplace API governs mid-commitment subscription updates:
      // quantity decreases are blocked, billing-term changes are essentially
      // impossible (PFR-86 documents $250K+ in credits from failed attempts;
      // the only documented workaround is cancel-and-reorder), and
      // commitment-term changes are admin-only. The CLI previously let users
      // attempt any of these and surfaced a flat opaque API rejection
      // post-confirm — same anti-pattern as orders create pre-#230.
      //
      // Quantity INCREASES are permitted (each gets its own vendor-specific
      // cancel window, but those windows are scattered across internal-only
      // VPM wiki pages — Rovo confirmed this — so we don't try to mirror them
      // here; we let increases pass through to the API.
      const commitEnd = activeCommitmentEndDate(sub);
      if (commitEnd) {
        const endLabel = formatDate(commitEnd);
        const days = daysUntil(commitEnd);

        // Quantity decrease — not permitted mid-commitment.
        if (options.quantity !== undefined) {
          const newQty = parseInt(options.quantity, 10);
          if (!Number.isNaN(newQty) && newQty < sub.quantity) {
            throw new CliError(
              `Can't decrease quantity on "${sub.productName ?? id}" mid-commitment`,
              [
                "Quantity decreases are not permitted during the commitment term",
                `Commitment ends ${endLabel} (${days} days from now)`,
              ],
              [
                `Wait until ${endLabel} to decrease quantity`,
                "Or use the Pax8 portal for early changes (may incur fees)",
              ],
              undefined,
              ERROR_API_VALIDATION,
            );
          }
        }

        // Billing-term change — not permitted mid-commitment.
        if (
          options.billingTerm !== undefined &&
          sub.billingTerm !== undefined &&
          options.billingTerm !== sub.billingTerm
        ) {
          throw new CliError(
            `Can't change billing term on "${sub.productName ?? id}" mid-commitment`,
            [
              "Billing-term changes are not permitted during the commitment term",
              "The current path requires cancel-and-reorder; this CLI does not automate that flow",
            ],
            [
              `Wait until commitment ends (${endLabel}) to change billing term`,
              "Or use the Pax8 portal for cancel-and-reorder workflow",
            ],
            undefined,
            ERROR_API_VALIDATION,
          );
        }
      }

      const updateData: Record<string, unknown> = {};

      if (options.quantity !== undefined) {
        let newQty = parseInt(options.quantity, 10);

        // Confirm quantity change (with option to adjust)
        const confirmedQty = await confirmWithChange(
          newQty < sub.quantity
            ? `Reduce from ${formatQuantity(sub.quantity)} to ${formatQuantity(newQty)}?`
            : `Update from ${formatQuantity(sub.quantity)} to ${formatQuantity(newQty)}?`,
          newQty,
          { label: "New quantity" },
        );
        if (confirmedQty === null) {
          process.stderr.write(chalk.yellow("\n  Update cancelled.\n\n"));
          return;
        }
        newQty = confirmedQty;

        updateData.quantity = newQty;
      }

      if (options.billingTerm) {
        updateData.billingTerm = options.billingTerm;
      }

      if (Object.keys(updateData).length === 0) {
        process.stderr.write(
          chalk.yellow("\n  No changes specified. Use --quantity or --billing-term.\n\n")
        );
        return;
      }

      const updateSpinner = createSpinner("Updating subscription...").start();
      const doneUpdate = markWriteInFlight("subscriptions");
      let updated;
      try {
        updated = await ctx.api.subscriptions.update(id, updateData);
      } finally {
        doneUpdate();
      }
      await invalidateCacheAfterWrite();
      updateSpinner.succeed("Subscription updated");

      if (ctx.outputFormat === "json") {
        output([updated], { format: "json" });
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      process.stdout.write("\n");
      process.stdout.write(`  ${chalk.dim("ID:".padEnd(18))}${updated.id}\n`);
      process.stdout.write(`  ${chalk.dim("Product:".padEnd(18))}${updated.productName}\n`);
      process.stdout.write(`  ${chalk.dim("Status:".padEnd(18))}${formatStatus(updated.status)}\n`);
      process.stdout.write(`  ${chalk.dim("Quantity:".padEnd(18))}${formatQuantity(updated.quantity)}\n`);
      process.stdout.write(`  ${chalk.dim("Billing Term:".padEnd(18))}${updated.billingTerm}\n`);
      process.stdout.write(`  ${chalk.dim("Price:".padEnd(18))}${formatCurrency(updated.price ?? 0)}\n`);
      process.stdout.write("\n");
    } catch (error) {
      // Wrap opaque API rejections (post-confirm) with a generic
      // commitment-restriction hint. We deliberately do NOT pattern-match the
      // flat `errors[]` string — Rovo confirmed it isn't a stable contract,
      // and brittle string matching has bitten the CLI before. The hint
      // simply points the user at `subscriptions show` so they can see the
      // commitment shape and decide.
      if (error instanceof ApiError && error.statusCode >= 400 && error.statusCode < 500) {
        const detail = extractErrorDetail(error.responseBody);
        const causes: string[] = [];
        if (detail) causes.push(detail);
        causes.push("This may be a commitment-term restriction");

        await handleCommandError(
          new CliError(
            `Can't update subscription "${id}"`,
            causes,
            [
              `Run \`${replCmd("pax8 subscriptions show")} ${id}\` to see commitment details`,
              "Quantity decreases and billing-term changes are blocked during the commitment term",
            ],
            undefined,
            ERROR_API_VALIDATION,
          ),
        );
        return;
      }

      await handleCommandError(error, undefined, "Failed to update subscription");
    }
  });
