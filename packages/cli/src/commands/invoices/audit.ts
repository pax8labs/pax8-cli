// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import { buildAction } from "../../lib/actions.js";
import chalk from "chalk";
import { buildContext } from "../../lib/context.js";
import { output } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError } from "../../lib/errors.js";
import { formatCurrency, formatQuantity } from "../../lib/formatters.js";
import { auditInvoices } from "@pax8/core";
import { resolveCompanyId } from "../../lib/resolve-company.js";
import { discrepancyId } from "./dispute.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import { validateMonth } from "../../lib/validate.js";
import { collectSubsWithSpinner } from "../../lib/subs-stream.js";

export const invoicesAuditCommand = new Command("audit")
  .description("Audit invoices against active subscriptions")
  .option("--month <YYYY-MM>", "Filter by month (YYYY-MM)")
  .option("--company <id|name>", "Filter by company ID or name")
  .addHelpText(
    "after",
    `
Examples:
  pax8 invoices audit
  pax8 invoices audit --month 2026-03
  pax8 invoices audit --company "Summit Healthcare"
  pax8 invoices audit --json

Note: this audit compares the partner's invoiced charges against their
current active subscriptions (a partner-side reconciliation). It is not
the same as Pax8's internal vendor reconciliation, which compares
vendor-billed amounts against Pax8's records (vendor-side).

JSON output (--json):
  Returns the audit report as a plain object:

  {
    "discrepancies": [{
      "companyId": string,
      "companyName": string,
      "productName": string,
      "invoicedQuantity": number,
      "activeQuantity": number,
      "delta": number,                    // invoicedQuantity − activeQuantity
      "dollarImpact": number,             // positive = overcharge, negative = undercharge
      "type": "overcharge" | "undercharge" | "unexpected",
      "discrepancyId": string             // stable id — pass to "pax8 invoices dispute --discrepancy <id>"
    }],
    "totalOvercharge": number,
    "totalUndercharge": number,
    "netImpact": number,
    "itemsAudited": number,
    "nextActions": [{ "command": string, "args": string[], "description": string, "isWrite": boolean }]
  }`
  )
  .action(async (options, command) => {
    const globalOpts = command.optsWithGlobals();
    const ctx = await buildContext(globalOpts);
    const spinner = createSpinner("Fetching invoices...");

    try {
      // #M-1: `options.month` is interpolated into `nextActions[].command`
      // strings on stdout that agents may extract and exec. Validate the
      // shape at the parse boundary so shell metacharacters can't ride a
      // `--month "2026-01; …"` value out through that channel.
      validateMonth(options.month);

      spinner.start();

      const companyId = options.company
        ? await resolveCompanyId(ctx, options.company)
        : undefined;

      // #613 Phase 2: walk every page of subscriptions so the audit
      // reconciles against the full portfolio. Pre-#628 the call was
      // `subscriptions.list({ companyId, size: ALL_SUBS_PAGE_SIZE })`,
      // which silently truncated reconciliation for partners with
      // >1000 subs (or >1000 subs at a single filtered company on the
      // upper end of "large").
      const [invoicesResult, allSubs] = await Promise.all([
        ctx.api.invoices.list({ month: options.month, companyId, size: 200 }),
        collectSubsWithSpinner(
          ctx.api.subscriptions.streamAll({ companyId }),
          spinner,
          "invoice audit",
        ),
      ]);

      // Fetch items for each invoice in parallel
      const allItems = (
        await Promise.all(
          invoicesResult.content.map((inv) =>
            ctx.api.invoices.listItems(inv.id, { size: 500 }).catch(() => ({ content: [] }))
          )
        )
      ).flatMap((r) => r.content);

      spinner.stop();

      const itemsResult = { content: allItems };

      // Normalize subscriptions for audit matching:
      // The auditor matches on subscriptionId first, falling back to companyId+productId.
      // Invoice items don't have subscriptionId, so we map subscriptions to use
      // companyId+productId matching by omitting the id field and setting subscriptionId undefined.
      //
      // Hoisted above the empty-invoice branch below, which needs the auditor's
      // own notion of "active" to decide what to report.
      const normalizedSubs = allSubs.map((s) => {
        const { id, ...rest } = s;
        return {
          ...rest,
          subscriptionId: undefined,
          unitPrice: s.price,
        };
      });

      // No invoiced line items in scope. What that MEANS depends on whether
      // there is anything on the subscription side to reconcile against.
      //
      // Previously this branch fired on `allItems.length === 0` alone and
      // always rendered a green checkmark, which made the audit invoice-first:
      // a company with active subscriptions and no invoice at all had nothing
      // to filter to and fell through to a clean bill of health.
      // `pax8 invoices audit --company "Acme Corp"` reported clean while the
      // unscoped audit listed five `missing` rows for that same company — a
      // false negative on a reconciliation tool, on the account with the
      // largest gap in the fixture.
      // Computed once when the scope has no invoice items and reused as the
      // final report if we fall through to case (c) — the inputs are identical
      // there (`itemsResult.content` is empty), so re-running the auditor would
      // duplicate the whole reconciliation on what is now a common path.
      let emptyScopeReport: ReturnType<typeof auditInvoices> | undefined;

      // Whether the audited period can be reconciled AT ALL is a property of
      // the period, not of whether this particular scope happened to return
      // invoice items — so it is classified here, above the empty-items
      // branch.
      //
      // `invoices.list` is month-filtered but the subscription fetch is not:
      // `subscriptions.streamAll({ companyId })` returns what is active RIGHT
      // NOW, and auditInvoices() keeps only status "active". For any period
      // other than the current one that population is wrong in both
      // directions — a subscription live then and cancelled since is absent
      // (so its invoice line looks `unexpected`), and one added since is
      // present (so it looks `missing`). Neither is a real finding.
      //
      // This used to live inside `if (allItems.length === 0)`, which meant a
      // past month WITH invoice items skipped the check entirely and
      // reconciled those lines against today's subscriptions — producing
      // exactly the invented rows the guard exists to prevent. Unreachable on
      // the demo fixture, whose historical invoices carry no line items, and
      // reachable in production, where they do.
      const period = compareToCurrentMonth(options.month);

      if (allItems.length === 0) {
        // Reuse the auditor's own active-status filter rather than
        // re-implementing it here; with no invoice items its itemsAudited is
        // exactly the count of active subscriptions it would reconcile.
        emptyScopeReport = auditInvoices([], normalizedSubs);
        const activeSubCount = emptyScopeReport.itemsAudited;

        // (a) Genuinely nothing in scope — no invoices AND no active subs.
        //     A checkmark is honest here.
        if (activeSubCount === 0) {
          if (ctx.outputFormat === "json") {
            process.stdout.write(
              JSON.stringify(
                { discrepancies: [], totalOvercharge: 0, totalUndercharge: 0, netImpact: 0, itemsAudited: 0 },
                null,
                2,
              ) + "\n",
            );
          } else if (ctx.outputFormat !== "quiet") {
            const monthLabel = options.month ? formatMonthLabel(options.month) : "current";
            process.stdout.write(`\n  ${chalk.green("✓")} No invoices found for ${monthLabel} period.\n\n`);
          }
          return;
        }

        // (b) A PAST month with active subs. We cannot reconcile this and we
        //     must not pretend otherwise in either direction.
        //
        //     `invoices.list` is month-filtered but the subscription fetch is
        //     not: `subscriptions.streamAll({ companyId })` returns what is
        //     active RIGHT NOW, and auditInvoices() keeps only status
        //     "active". So a subscription that was live in the audited month
        //     and has since been cancelled is absent from the fetch entirely
        //     — no filter over this data recovers it. Emitting `missing` rows
        //     here would invent findings for subscriptions that did not exist
        //     in the audited period; emitting a checkmark would repeat the
        //     false all-clear. Report the gap instead.
        if (period !== "current") {
          if (ctx.outputFormat !== "quiet") {
            const monthLabel = formatMonthLabel(options.month!);
            const why =
              period === "past"
                ? `subscription history is\n    only available as of today, so a past period cannot be audited\n    against it.`
                : `that period has not occurred yet, so\n    there is nothing to reconcile against.`;
            process.stderr.write(
              `\n  ${chalk.yellow("⚠")} No invoiced line items for ${monthLabel}.\n` +
                `    ${activeSubCount} active subscription${activeSubCount === 1 ? "" : "s"} ` +
                `${activeSubCount === 1 ? "was" : "were"} NOT reconciled — ${why}\n\n` +
                `    ${chalk.dim("This is not a clean bill of health.")}\n\n`,
            );
          }
          if (ctx.outputFormat === "json") {
            // Envelope shape is unchanged — the warning rides on stderr so
            // `--json | jq` stays valid. Note itemsAudited: 0 still cannot be
            // distinguished from "audited, all clean" by a JSON consumer;
            // that is the known #709 gap, tracked separately.
            process.stdout.write(
              JSON.stringify(
                { discrepancies: [], totalOvercharge: 0, totalUndercharge: 0, netImpact: 0, itemsAudited: 0 },
                null,
                2,
              ) + "\n",
            );
          }
          return;
        }

        // (c) Current period with active subs — "active now" IS the correct
        //     population, so those subs genuinely should have been invoiced.
        //     Fall through: auditInvoices() marks every unmatched sub
        //     `missing`, which is exactly what the unscoped audit reports for
        //     the same company.
      }

      // A non-current period that DOES have invoice items still cannot be
      // reconciled reliably, for the reason above. The findings are not
      // suppressed — some are real, and refusing outright would remove a
      // capability partners use — but they are not presented as trustworthy
      // either. Warn on stderr so `--json | jq` stays valid, then report.
      if (period !== "current" && allItems.length > 0 && ctx.outputFormat !== "quiet") {
        const monthLabel = formatMonthLabel(options.month!);
        process.stderr.write(
          `\n  ${chalk.yellow("⚠")} ${monthLabel} is not the current period.\n` +
            `    Subscriptions are only available as of today, so these findings may\n` +
            `    include rows for subscriptions that did not exist in that period —\n` +
            `    and miss ones that have since been cancelled.\n\n`,
        );
      }

      // Run audit (reusing the empty-scope report when one was computed above)
      const report = emptyScopeReport ?? auditInvoices(itemsResult.content, normalizedSubs);

      // Stamp each discrepancy with a stable ID so `pax8 invoices dispute
      // --discrepancy <id>` can locate it without re-auditing under the user's
      // exact filters.
      const stampedDiscrepancies = report.discrepancies.map((d) => ({
        ...d,
        discrepancyId: discrepancyId({
          companyId: d.companyId,
          productName: d.productName,
          type: d.type,
          month: options.month,
        }),
      }));

      // JSON output
      if (ctx.outputFormat === "json") {
        // Every one of these is `invoices dispute` — a write emitted by a
        // read command. `isWrite: true` is what stops an agent filing five
        // disputes off the back of running an audit (#708).
        const nextActions = stampedDiscrepancies
          .slice(0, 5)
          .map((d) =>
            buildAction(
              [
                "invoices",
                "dispute",
                "--discrepancy",
                d.discrepancyId,
                ...(options.month ? ["--month", String(options.month)] : []),
              ],
              `File a dispute for ${d.companyName} — ${d.productName} (${d.type}, Δ${d.delta > 0 ? "+" : ""}${d.delta})`,
            ),
          );
        process.stdout.write(
          JSON.stringify(
            { ...report, discrepancies: stampedDiscrepancies, nextActions },
            null,
            2,
          ) + "\n",
        );
        return;
      }

      if (ctx.outputFormat === "quiet") return;

      // CSV output
      if (ctx.outputFormat === "csv") {
        const columns = [
          { key: "companyName", header: "Company" },
          { key: "productName", header: "Product" },
          { key: "invoicedQuantity", header: "Invoiced Qty" },
          { key: "activeQuantity", header: "Active Qty" },
          { key: "delta", header: "Delta" },
          { key: "dollarImpact", header: "Dollar Impact" },
          { key: "type", header: "Type" },
        ];
        output(report.discrepancies, { format: "csv", columns });
        return;
      }

      // Human-readable audit report
      const monthLabel = options.month
        ? formatMonthLabel(options.month)
        : "current";

      if (report.discrepancies.length === 0) {
        process.stdout.write(
          `\n  ${chalk.green("✓")} No discrepancies found in ${monthLabel} invoices.\n\n`
        );
        return;
      }

      process.stdout.write(
        `\n  ${chalk.yellow("⚠")} ${report.discrepancies.length} discrepancies found in ${monthLabel} invoices:\n\n`
      );

      // Prefix each discrepancy with `N.` so the partner can read the
      // pickable list below as a direct reference into this output (e.g.
      // "type 3 to dispute discrepancy #3"). Keeps the existing single-id
      // form in the `[…]` brackets so partners who copy-paste the id by
      // hand can still locate it.
      stampedDiscrepancies.forEach((d, i) => {
        const idx = i + 1;
        process.stdout.write(
          `  ${chalk.bold(`${idx}.`)} ${chalk.bold(d.companyName)} — ${d.productName}  ${chalk.dim(`[${d.discrepancyId}]`)}\n`
        );

        const deltaSign = d.delta > 0 ? "+" : "";
        const impactLabel =
          d.dollarImpact > 0
            ? `${formatCurrency(d.dollarImpact)} overcharge`
            : `${formatCurrency(Math.abs(d.dollarImpact))} undercharge`;

        process.stdout.write(
          `     Invoiced: ${formatQuantity(d.invoicedQuantity)}    Active: ${formatQuantity(d.activeQuantity)}    Δ ${deltaSign}${d.delta} (${impactLabel})\n`
        );
        process.stdout.write("\n");
      });

      // Footer with totals
      process.stdout.write(chalk.dim("  ─────────────────────────────\n"));
      if (report.totalOvercharge > 0) {
        process.stdout.write(
          `  ${chalk.red("Overcharges:")}  ${formatCurrency(report.totalOvercharge)}\n`
        );
      }
      if (report.totalUndercharge > 0) {
        process.stdout.write(
          `  ${chalk.yellow("Undercharges:")} ${formatCurrency(report.totalUndercharge)}\n`
        );
      }
      process.stdout.write(
        `  ${chalk.bold("Net impact:")}   ${formatCurrency(report.netImpact)}\n`
      );
      process.stdout.write("\n");

      // Closed-loop hint: every discrepancy becomes a pickable dispute
      // entry. Partners can scan the indexed list above, type a number, and
      // the dispute is drafted with the discrepancy id (and month, when
      // filtering by month) carried through automatically.
      if (stampedDiscrepancies.length > 0) {
        const monthArgs = options.month ? ["--month", options.month] : [];
        const steps: NextStep[] = stampedDiscrepancies.map((d, i) => {
          const command = ["invoices", "dispute", "--discrepancy", d.discrepancyId, ...monthArgs];
          return {
            key: String(i + 1),
            // Company and product are already on the numbered discrepancy
            // line directly above this menu, so repeating them here only
            // overran terminal width (#731).
            label: chalk.cyan(replCmd(`pax8 invoices dispute --discrepancy ${d.discrepancyId}`)),
            command,
          };
        });
        await promptNextSteps(steps, { renderList: true, header: "  Try next:\n" });
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to audit invoices");
    }
  });

/**
 * Classify `month` (YYYY-MM) against the current period.
 *
 * Only the CURRENT period can be reconciled against the subscription list,
 * because `subscriptions.streamAll()` returns what is active right now and
 * carries no history. A PAST month is missing subscriptions that have since
 * been cancelled; a FUTURE month has not happened at all. Emitting `missing`
 * rows for either would invent findings, so both are reported as unreconciled
 * — an earlier version guarded only the past, which let a future `--month`
 * produce discrepancies for a period that had not occurred.
 *
 * Compared in UTC to match how the demo fixture derives its invoice dates
 * (`monthsAgo()` in demo-data.ts) so a partner near a month boundary sees the
 * same classification the fixtures were built against.
 */
function compareToCurrentMonth(month: string | undefined): "current" | "past" | "future" {
  if (!month) return "current";
  const now = new Date();
  const current = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  if (month === current) return "current";
  return month < current ? "past" : "future";
}

function formatMonthLabel(month: string): string {
  const [year, m] = month.split("-");
  const date = new Date(parseInt(year), parseInt(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
