// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import {
  ERROR_INVALID_INPUT,
  ERROR_TERM_NOT_FOUND,
} from "@pax8/core";
import { getOutputFormat } from "../lib/context.js";
import { CliError, handleCommandError } from "../lib/errors.js";
import { suggest } from "../lib/fuzzy.js";
import {
  GLOSSARY,
  type GlossaryCategory,
  type GlossaryEntry,
  allCanonicalTerms,
  lookupTerm,
  normalizeTerm,
} from "./explain-glossary.js";

/**
 * `pax8 explain <term>` — built-in glossary. #656 / UXR F8.
 *
 * Fully local: no API, no auth, no config. We read the output format
 * off `--json` directly via `getOutputFormat` and skip `buildContext`
 * entirely so that (a) there's no token refresh on a docs command and
 * (b) the demo-mode banner doesn't fire on something that has no data
 * to demo.
 */

const CATEGORY_ORDER: readonly GlossaryCategory[] = [
  "recommendation",
  "subscription",
  "billing",
  "product",
  "operational",
];

const CATEGORY_LABEL: Record<GlossaryCategory, string> = {
  recommendation: "Recommendations",
  subscription: "Subscriptions",
  billing: "Billing",
  product: "Products",
  operational: "Operational",
};

export const explainCommand = new Command("explain")
  .description("Explain a Pax8 CLI or marketplace term")
  .argument("[term...]", "Term to explain — joined with spaces if multi-word")
  .option("--list", "List all known terms, grouped by category")
  .addHelpText(
    "after",
    `
Examples:
  pax8 explain seat-gap
  pax8 explain "opportunity type"
  pax8 explain seat_gap --json
  pax8 explain --list
  pax8 explain --list --json

Aliases and normalization:
  Space, underscore, and case are all normalized. \`seat gap\`, \`SEAT_GAP\`,
  and \`seat-gap\` all resolve to the same entry.`
  )
  .action(async (termArgs: string[], options: { list?: boolean }, command) => {
    try {
      const globalOpts = command.optsWithGlobals();
      const format = getOutputFormat(globalOpts);
      const wantJson = format === "json";
      const wantQuiet = format === "quiet";

      // --list and a positional term are a nonsense combo — reject explicitly
      // rather than silently ignoring one. Same reasoning as most CLIs
      // enforce mutex flag/arg pairs.
      if (options.list && termArgs.length > 0) {
        throw new CliError(
          `\`--list\` and a term argument are mutually exclusive.`,
          [`You passed both: --list and \`${termArgs.join(" ")}\`.`],
          [`Use \`pax8 explain --list\` to see every known term, or \`pax8 explain ${termArgs[0]}\` to look up one term.`],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      if (options.list) {
        renderList({ wantJson, wantQuiet });
        return;
      }

      if (termArgs.length === 0) {
        throw new CliError(
          `Missing term to explain.`,
          [],
          [
            `Try \`pax8 explain seat-gap\` — or \`pax8 explain --list\` to browse every term.`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      // Variadic args let partners type `pax8 explain MRR uplift` without
      // shell-quoting the space. Join, then normalize.
      const rawInput = termArgs.join(" ");
      const entry = lookupTerm(rawInput);

      if (!entry) {
        const suggestions = suggest(
          normalizeTerm(rawInput),
          allCanonicalTerms(),
        );
        // Strip C0/C1 control chars so an input carrying ANSI escapes
        // can't repaint the surrounding error banner. redactString() only
        // scrubs PII patterns, not terminal control bytes.
        const safeInput = rawInput.replace(/[\x00-\x1f\x7f-\x9f]/g, "");
        throw new CliError(
          `No glossary entry for "${safeInput}".`,
          suggestions.length > 0
            ? [`Nearest matches: ${suggestions.join(", ")}.`]
            : [],
          suggestions.length > 0
            ? [
                `Try \`pax8 explain ${suggestions[0]}\`, or run \`pax8 explain --list\` to browse every term.`,
              ]
            : [
                `Run \`pax8 explain --list\` to browse every term.`,
              ],
          undefined,
          ERROR_TERM_NOT_FOUND,
        );
      }

      renderEntry(entry, { wantJson, wantQuiet });
    } catch (error) {
      await handleCommandError(error, undefined, "Failed to explain term");
    }
  });

// ─── Renderers ─────────────────────────────────────────────────────────────

function renderEntry(
  entry: GlossaryEntry,
  { wantJson, wantQuiet }: { wantJson: boolean; wantQuiet: boolean },
): void {
  if (wantQuiet) return;

  if (wantJson) {
    process.stdout.write(
      JSON.stringify(
        {
          term: entry.term,
          category: entry.category,
          short: entry.short,
          detail: entry.detail ?? null,
          seeAlso: entry.seeAlso ?? [],
          reference: entry.reference ?? null,
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Text: title, blank line, indented short/detail, then a metadata block.
  process.stdout.write("\n" + chalk.bold(entry.term.replace(/-/g, " ")) + "\n\n");
  process.stdout.write("  " + entry.short + "\n");
  if (entry.detail) {
    process.stdout.write("\n  " + entry.detail + "\n");
  }

  const metaLines: string[] = [];
  metaLines.push(`  ${chalk.dim("Category:")}   ${CATEGORY_LABEL[entry.category]}`);
  if (entry.reference) {
    metaLines.push(`  ${chalk.dim("Referenced:")} ${chalk.cyan(entry.reference)}`);
  }
  if (entry.seeAlso && entry.seeAlso.length > 0) {
    metaLines.push(
      `  ${chalk.dim("See also:")}   ${entry.seeAlso.map((s) => chalk.cyan(s)).join(", ")}`,
    );
  }
  process.stdout.write("\n" + metaLines.join("\n") + "\n\n");
}

function renderList({
  wantJson,
  wantQuiet,
}: {
  wantJson: boolean;
  wantQuiet: boolean;
}): void {
  if (wantQuiet) return;

  if (wantJson) {
    const rows = [...GLOSSARY]
      .sort((a, b) => a.term.localeCompare(b.term))
      .map((e) => ({
        term: e.term,
        category: e.category,
        short: e.short,
      }));
    process.stdout.write(JSON.stringify({ terms: rows }, null, 2) + "\n");
    return;
  }

  process.stdout.write("\n" + chalk.bold("Pax8 CLI glossary") + "\n");
  process.stdout.write(
    chalk.dim(`  ${GLOSSARY.length} terms · run `) +
      chalk.cyan("pax8 explain <term>") +
      chalk.dim(` for a full entry.\n\n`),
  );

  for (const category of CATEGORY_ORDER) {
    const entries = GLOSSARY.filter((e) => e.category === category);
    if (entries.length === 0) continue;
    entries.sort((a, b) => a.term.localeCompare(b.term));
    process.stdout.write("  " + chalk.bold(CATEGORY_LABEL[category]) + "\n");
    // Column-align term slugs so definitions line up. The longest term in
    // the v1 set is `opportunity-type` (16 chars); leave room for growth.
    const width = Math.max(...entries.map((e) => e.term.length));
    for (const e of entries) {
      process.stdout.write(
        `    ${chalk.cyan(e.term.padEnd(width))}  ${chalk.dim(e.short)}\n`,
      );
    }
    process.stdout.write("\n");
  }
}
