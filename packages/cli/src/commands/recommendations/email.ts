// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT, ERROR_RECOMMENDATION_NOT_FOUND } from "@pax8/core";
import { getOutputFormat } from "../../lib/context.js";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { formatCurrency } from "../../lib/formatters.js";
import { replCmd } from "../../lib/confirm.js";
import { openUrl } from "../../lib/open-url.js";
import { loadCache, type CachedRec } from "./why.js";

/**
 * `pax8 recommendations email <n>` — draft a customer-ready email from
 * the specified recommendation and hand off to the partner's mail
 * client via a `mailto:` URL. #658 / UXR F3.
 *
 * Design constraint: the CLI must NOT send. It emits a draft (JSON
 * envelope, mailto: URL, or system-opener hand-off) — the partner or
 * their mail client is the sender-of-record. Matches the safety
 * contract in `packages/claude-skill/skill.md`.
 */

interface Draft {
  to: string | null;
  subject: string;
  body: string;
  mailto: string;
  rationaleSnippet: string | null;
  reason: string | null;
  productSummary: string[];
  estimatedMrrUplift: number | null;
  companyName: string;
}

export const recommendationsEmailCommand = new Command("email")
  .description(
    "Draft a customer-ready email for a specific recommendation and hand off to your default mail client",
  )
  .argument("<n>", "The `#` from the recommendations table")
  .option(
    "--to <email>",
    "Populate the To: field on the mailto URL. When omitted, the mail client prompts.",
  )
  .option(
    "--mailto",
    "Print only the mailto: URL (pipeable to `open`, `pbcopy`, `xclip`, etc.)",
  )
  .option(
    "--open",
    "Fire the OS-native URL opener (macOS `open`, Linux `xdg-open`, Windows `start`) to launch the mail client with the draft pre-populated",
  )
  .addHelpText(
    "after",
    `
Examples:
  pax8 recommendations email 1
  pax8 recommendations email 1 --to alice@example.com
  pax8 recommendations email 1 --mailto | pbcopy
  pax8 recommendations email 1 --open
  pax8 recommendations email 1 --json

Reads the cached output of the last \`pax8 recommendations list\` — run
that first if you get a "no cached recommendations" error.

The CLI never sends the email — it hands the drafted subject + body to
your default mail client (via a mailto: URL). You review and send.`,
  )
  .action(
    async (
      nRaw: string,
      options: { to?: string; mailto?: boolean; open?: boolean },
      command,
    ) => {
      try {
        const globalOpts = command.optsWithGlobals();
        const format = getOutputFormat(globalOpts);
        const wantJson = format === "json";
        const wantQuiet = format === "quiet";

        const n = parseInt(nRaw, 10);
        if (Number.isNaN(n) || n <= 0) {
          throw new CliError(
            `\`${nRaw}\` is not a valid recommendation index.`,
            [
              `Expected a positive integer matching the \`#\` column in \`pax8 recommendations list\`.`,
            ],
            [
              `Run \`${replCmd("pax8 recommendations list")}\` to see the current numbering.`,
            ],
            undefined,
            ERROR_INVALID_INPUT,
          );
        }

        const cache = loadCache();
        const entry = cache.find((e) => e.key === String(n));
        if (!entry) {
          throw new CliError(
            `No recommendation #${n} in the last \`pax8 recommendations list\`.`,
            [
              `Cached results contain ${cache.length} recommendation${cache.length === 1 ? "" : "s"} — valid indexes are 1..${cache.length}.`,
            ],
            [
              `Re-run \`${replCmd("pax8 recommendations list")}\` if the portfolio has changed.`,
              `Or pick a different index (1..${cache.length}).`,
            ],
            undefined,
            ERROR_RECOMMENDATION_NOT_FOUND,
          );
        }

        const draft = buildDraft(entry.rec, options.to);

        if (options.open) {
          // Print the URL first so it's visible even if the opener silently
          // fails (headless SSH, missing xdg-open, no default handler, etc.).
          // Same affordance pattern as `auth/login.ts` and `report-bug.ts`.
          process.stderr.write(chalk.dim(`  Opening: ${draft.mailto}\n`));
          const opened = await openUrl(draft.mailto);
          if (!opened) {
            process.stderr.write(
              chalk.yellow(
                `  Couldn't launch a mail client. Copy the URL above into your browser or mail app.\n`,
              ),
            );
          }
          return;
        }

        if (options.mailto) {
          // Stdout-only single-line URL — safe to pipe to `open`, `pbcopy`,
          // `xclip`, `wl-copy`, `clip.exe`, etc.
          process.stdout.write(draft.mailto + "\n");
          return;
        }

        renderDraft(draft, { wantJson, wantQuiet });
      } catch (error) {
        await handleCommandError(error, undefined, "Failed to draft email");
      }
    },
  );

// ─── Draft builder ─────────────────────────────────────────────────────────

function buildDraft(rec: CachedRec, to: string | undefined): Draft {
  const kind: "seat_gap" | "cross_sell" =
    rec.type === "seat_gap" ? "seat_gap" : "cross_sell";
  const primaryProduct = rec.suggestedProducts?.[0] ?? "the recommended product";
  const upliftLabel =
    rec.estimatedMrrUplift != null
      ? `${formatCurrency(rec.estimatedMrrUplift)}/mo`
      : null;

  const subject =
    kind === "seat_gap"
      ? `Bridging your ${primaryProduct} coverage gap`
      : `A gap worth addressing in ${rec.companyName}'s stack`;

  const bodyLines: string[] =
    kind === "seat_gap"
      ? seatGapBody(rec, primaryProduct, upliftLabel)
      : crossSellBody(rec, primaryProduct, upliftLabel);

  const body = bodyLines.join("\n");

  // mailto: URL. Per RFC 6068 we percent-encode subject and body via
  // encodeURIComponent, then swap `+` back to `%20` because some mail
  // clients (notably older Outlook installs) treat `+` as a literal.
  const encode = (s: string): string =>
    encodeURIComponent(s).replace(/\+/g, "%20");
  const params = [
    `subject=${encode(subject)}`,
    `body=${encode(body)}`,
  ];
  const mailto = `mailto:${to ? encodeURIComponent(to) : ""}?${params.join("&")}`;

  return {
    to: to ?? null,
    subject,
    body,
    mailto,
    rationaleSnippet: rec.rationaleSnippet ?? null,
    reason: rec.reason ?? null,
    productSummary: rec.suggestedProducts ?? [],
    estimatedMrrUplift: rec.estimatedMrrUplift ?? null,
    companyName: rec.companyName,
  };
}

function seatGapBody(
  rec: CachedRec,
  primaryProduct: string,
  upliftLabel: string | null,
): string[] {
  const anchor = rec.rationaleSnippet ?? "a cross-product seat mismatch";
  const reasonLine =
    rec.reason ??
    `${primaryProduct} coverage is behind the rest of the stack, leaving some users unprotected.`;
  const seats = rec.targetSeats != null ? `${rec.targetSeats} more seats` : "additional seats";
  const priceClause = upliftLabel
    ? `and cost about ${upliftLabel} more`
    : "";

  return [
    `Hi ${rec.companyName},`,
    "",
    `Reviewing your Pax8 stack today, I noticed ${anchor} — for context, ${reasonLine}`,
    "",
    `Adding ${seats} of ${primaryProduct} would close the gap ${priceClause}, keeping every user covered under the same policy.`,
    "",
    `Happy to walk through this together — reply and we'll set a time.`,
    "",
    `<partner name>`,
  ];
}

function crossSellBody(
  rec: CachedRec,
  primaryProduct: string,
  upliftLabel: string | null,
): string[] {
  const reasonLine =
    rec.reason ??
    `there's a gap in the stack worth closing.`;
  const priceClause = upliftLabel
    ? `estimated added cost around ${upliftLabel}.`
    : "impact varies by seat count — happy to price it for you.";

  return [
    `Hi ${rec.companyName},`,
    "",
    `Auditing your subscriptions today, one gap stood out: ${reasonLine}`,
    "",
    `${primaryProduct} would close it — ${priceClause} It ties in cleanly with what you already run, and the switch is minimal-touch.`,
    "",
    `Happy to walk through this — reply and we'll set a time.`,
    "",
    `<partner name>`,
  ];
}

// ─── Renderer (default text + --json paths) ────────────────────────────────

function renderDraft(
  draft: Draft,
  { wantJson, wantQuiet }: { wantJson: boolean; wantQuiet: boolean },
): void {
  if (wantQuiet) return;

  if (wantJson) {
    process.stdout.write(
      JSON.stringify(
        {
          draft: {
            to: draft.to,
            subject: draft.subject,
            body: draft.body,
            mailto: draft.mailto,
            rationaleSnippet: draft.rationaleSnippet,
            reason: draft.reason,
            product_summary: draft.productSummary,
            estimatedMrrUplift: draft.estimatedMrrUplift,
            companyName: draft.companyName,
          },
        },
        null,
        2,
      ) + "\n",
    );
    return;
  }

  // Human text mode: show the drafted subject + body so partners can
  // copy manually, and surface the mailto URL as a next-step hint.
  process.stdout.write("\n" + chalk.bold("Subject: ") + draft.subject + "\n\n");
  process.stdout.write(draft.body + "\n\n");

  process.stderr.write(
    chalk.dim("Hand off to your mail client:\n") +
      chalk.dim("  · Open now:    ") +
      chalk.cyan(replCmd("pax8 recommendations email <n> --open")) +
      "\n" +
      chalk.dim("  · Copy URL:    ") +
      chalk.cyan(replCmd("pax8 recommendations email <n> --mailto") + " | pbcopy") +
      "\n" +
      chalk.dim("  · Populate To: add ") +
      chalk.cyan("--to alice@example.com") +
      "\n\n",
  );
  process.stderr.write(chalk.dim("Or copy the mailto URL directly:\n"));
  process.stderr.write("  " + chalk.cyan(draft.mailto) + "\n\n");
}
