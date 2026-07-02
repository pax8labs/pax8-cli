// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ERROR_INVALID_INPUT, ERROR_RECOMMENDATION_NOT_FOUND, getConfigDir } from "@pax8/core";
import { getOutputFormat } from "../../lib/context.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";

/**
 * `pax8 recommendations why <n>` — expanded rationale for a specific
 * recommendation. #655 / UXR F5.
 *
 * Reads the `pending-actions.json` cache written by `recommendations
 * list`. No API call — everything the drill-down needs was persisted
 * there. If the user hasn't run `list` yet (no cache), or the index
 * is out of range, we throw `ERROR_RECOMMENDATION_NOT_FOUND` with a
 * clear recovery hint.
 */

interface CachedRec {
  companyId: string;
  companyName: string;
  title: string;
  orderArgs: string[] | null;
  orderCommand: string | null;
  suggestedProducts: string[];
  targetSeats: number | null;
  // #655 additions: everything the drill-down surfaces beyond title.
  type?: "cross_sell" | "seat_gap";
  priority?: "high" | "medium" | "low";
  opportunityType?: string;
  reason?: string;
  rationaleSnippet?: string;
  estimatedMrrUplift?: number | null;
  productAvailable?: boolean;
}

interface CachedEntry {
  key: string;
  rec: CachedRec;
}

// Which glossary terms each rec type wants to point at. Kept minimal;
// the drill-down output shows them as `pax8 explain <term>` hints so
// partners can jump to the definition without leaving the workflow.
const SEE_ALSO_BY_TYPE: Record<"seat_gap" | "cross_sell", string[]> = {
  seat_gap: ["seat-gap", "mrr-uplift", "opportunity-type"],
  cross_sell: ["cross-sell", "mrr-uplift", "opportunity-type"],
};

function loadCache(): CachedEntry[] {
  const file = join(getConfigDir(), "pending-actions.json");
  if (!existsSync(file)) {
    throw new CliError(
      `No cached recommendations found.`,
      [`The drill-down reads the last \`pax8 recommendations list\` invocation's output from \`${file}\`.`],
      [
        `Run \`${replCmd("pax8 recommendations list")}\` first, then re-run this command.`,
      ],
      undefined,
      ERROR_RECOMMENDATION_NOT_FOUND,
    );
  }
  const raw = readFileSync(file, "utf8");
  return JSON.parse(raw) as CachedEntry[];
}

export const recommendationsWhyCommand = new Command("why")
  .description("Explain a specific recommendation from the last `recommendations list`")
  .argument("<n>", "The `#` from the recommendations table")
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations why 1
  pax8 recommendations why 3 --json

Reads the cached output of the last \`pax8 recommendations list\` — run
that first if you get a "no cached recommendations" error.`
  )
  .action(async (nRaw: string, _options, command) => {
    try {
      const globalOpts = command.optsWithGlobals();
      const format = getOutputFormat(globalOpts);
      const wantJson = format === "json";
      const wantQuiet = format === "quiet";

      const n = parseInt(nRaw, 10);
      if (Number.isNaN(n) || n <= 0) {
        throw new CliError(
          `\`${nRaw}\` is not a valid recommendation index.`,
          [`Expected a positive integer matching the \`#\` column in \`pax8 recommendations list\`.`],
          [`Run \`${replCmd("pax8 recommendations list")}\` to see the current numbering.`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const cache = loadCache();
      const entry = cache.find((e) => e.key === String(n));
      if (!entry) {
        throw new CliError(
          `No recommendation #${n} in the last \`pax8 recommendations list\`.`,
          [`Cached results contain ${cache.length} recommendation${cache.length === 1 ? "" : "s"} — valid indexes are 1..${cache.length}.`],
          [
            `Re-run \`${replCmd("pax8 recommendations list")}\` if the portfolio has changed.`,
            `Or pick a different index (1..${cache.length}).`,
          ],
          undefined,
          ERROR_RECOMMENDATION_NOT_FOUND,
        );
      }

      renderWhy(entry, { wantJson, wantQuiet });
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to explain recommendation");
    }
  });

// ─── Renderer ──────────────────────────────────────────────────────────────

function renderWhy(
  entry: CachedEntry,
  { wantJson, wantQuiet }: { wantJson: boolean; wantQuiet: boolean },
): void {
  if (wantQuiet) return;

  const { rec } = entry;
  const seeAlso =
    rec.type && SEE_ALSO_BY_TYPE[rec.type] ? SEE_ALSO_BY_TYPE[rec.type] : ["mrr-uplift", "opportunity-type"];

  if (wantJson) {
    process.stdout.write(
      JSON.stringify(
        {
          index: parseInt(entry.key, 10),
          companyId: rec.companyId,
          companyName: rec.companyName,
          type: rec.type ?? null,
          opportunityType: rec.opportunityType ?? null,
          priority: rec.priority ?? null,
          title: rec.title,
          reason: rec.reason ?? null,
          rationaleSnippet: rec.rationaleSnippet ?? null,
          estimatedMrrUplift: rec.estimatedMrrUplift ?? null,
          productAvailable: rec.productAvailable ?? null,
          targetSeats: rec.targetSeats,
          orderArgs: rec.orderArgs,
          seeAlso,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  const typeLabel = rec.type === "seat_gap" ? "Seat Gap" : rec.type === "cross_sell" ? "Cross-sell" : "Recommendation";
  const priorityChip =
    rec.priority === "high"
      ? chalk.red.bold("HIGH")
      : rec.priority === "medium"
        ? chalk.yellow("MED")
        : rec.priority === "low"
          ? chalk.dim("LOW")
          : "";
  const upliftChip =
    rec.estimatedMrrUplift != null
      ? chalk.green(`+${formatCurrency(rec.estimatedMrrUplift)}/mo Pax8 cost`)
      : "";

  process.stdout.write("\n" + chalk.bold(`Recommendation #${entry.key}`) + "\n");
  const headerBits = [chalk.cyan(rec.companyName), typeLabel, priorityChip, upliftChip].filter((s) => s.length > 0);
  process.stdout.write("  " + headerBits.join(chalk.dim(" · ")) + "\n\n");
  process.stdout.write("  " + rec.title + "\n\n");

  if (rec.reason) {
    process.stdout.write(chalk.bold("Why this recommendation") + "\n");
    process.stdout.write("  " + wrap(rec.reason, 74) + "\n\n");
  }

  // Sort narrative — a global property, not per-rec, but the drill-down is
  // the natural place to answer "why is this one first?" too.
  process.stdout.write(chalk.bold("Why it ranks here") + "\n");
  process.stdout.write(
    "  " +
      wrap(
        "Sorted by estimated monthly Pax8 cost uplift, descending. Priority (high, medium, low) is the tiebreaker — but a $5k/mo medium still ranks above a $500/mo high on the primary sort.",
        74,
      ) +
      "\n\n",
  );

  const facts: string[] = [];
  if (rec.productAvailable != null) {
    facts.push(`Orderable now: ${rec.productAvailable ? chalk.green("yes") : chalk.dim("no")}`);
  }
  if (rec.targetSeats != null) facts.push(`Target seats: ${rec.targetSeats}`);
  if (facts.length > 0) {
    process.stdout.write("  " + facts.join(chalk.dim("  ·  ")) + "\n\n");
  }

  process.stdout.write(chalk.dim("See also:  ") + seeAlso.map((s) => chalk.cyan(replCmd(`pax8 explain ${s}`))).join(chalk.dim("    ")) + "\n");
  process.stdout.write(chalk.dim("To act:    ") + chalk.cyan(replCmd("pax8 recommendations act")) + "\n\n");
}

/**
 * Simple word-wrap for the "Why" paragraphs. Two-space indent is applied
 * by the caller; this function just splits on whitespace to `width` chars.
 */
function wrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.join("\n  ");
}
