// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import { ERROR_INVALID_INPUT } from "@pax8/core";
import { buildContext } from "../../lib/context.js";
import { output, type Column } from "../../lib/output.js";
import { createSpinner } from "../../lib/spinner.js";
import { handleCommandError, CliError } from "../../lib/errors.js";
import { resolveCompany } from "../../lib/resolve-company.js";
import { replCmd } from "../../lib/confirm.js";
import { promptNextSteps, type NextStep } from "../../lib/next-step.js";
import { clampListSize, LIST_SIZE_CAP, warnSizeClamped } from "../../lib/validate.js";

export const contactsListCommand = new Command("list")
  .description("List contacts for a company")
  .option("--company <id|name>", "Company ID or name (required)")
  .option("--page <number>", "Page number", "1")
  .option("--size <number>", `Page size (max ${LIST_SIZE_CAP}; larger values are clamped)`, "50")
  .option("--ids-only", "Output only resource IDs, one per line")
  .addHelpText(
    "after",
    `
Examples:
  pax8 contacts list --company "Summit Healthcare Partners"
  pax8 contacts list --company a1b2c3d4-e5f6-7890-abcd-ef1234567890
  pax8 contacts list --company "Summit Healthcare Partners" --json
  pax8 contacts list --company "Summit Healthcare Partners" --csv
  pax8 contacts list --company "Summit Healthcare Partners" --ids-only | xargs -I{} pax8 contacts show {} --company "Summit Healthcare Partners"`
  )
  .action(async (options, command) => {
    const allOpts = command.optsWithGlobals();
    const ctx = await buildContext(allOpts);
    const spinner = createSpinner("Fetching contacts...");

    try {
      if (!allOpts.company) {
        throw new CliError(
          "--company is required",
          ["The Pax8 contacts API is scoped to a single company"],
          [
            `Pick a client first: ${replCmd("pax8 clients list")}`,
            `Then: ${replCmd("pax8 contacts list")} --company <id|name>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      spinner.start();
      const company = await resolveCompany(ctx, allOpts.company);
      const apiPage = Math.max(parseInt(allOpts.page, 10) - 1, 0);
      // #518: clamp `--size` at LIST_SIZE_CAP (1000).
      const sizeResult = clampListSize(parseInt(allOpts.size, 10), 50);
      if (sizeResult.clamped) {
        warnSizeClamped(sizeResult.requested, LIST_SIZE_CAP, { quiet: allOpts.quiet });
      }
      const result = await ctx.api.contacts.list(company.id, {
        page: apiPage,
        size: sizeResult.size,
      });
      spinner.stop();

      if (allOpts.idsOnly) {
        for (const item of result.content) {
          process.stdout.write(item.id + "\n");
        }
        return;
      }

      const columns: Column[] = [
        { key: "id", header: "ID", width: 14, format: (v) => chalk.dim(String(v).slice(0, 12)) },
        { key: "firstName", header: "First", width: 14 },
        { key: "lastName", header: "Last", width: 16 },
        { key: "email", header: "Email", width: 38 },
        {
          key: "types",
          header: "Types",
          width: 22,
          // `types` is `Array<{type, primary}>` per the public spec (#325).
          // Render as a comma-separated list of kind names with a `*` marker
          // on any entry flagged `primary: true`, so the table view surfaces
          // the spec's `primary` bit without an extra column. Fall back to
          // legacy string entries defensively.
          format: (v) => {
            if (!Array.isArray(v)) return String(v ?? "");
            return v
              .map((entry) => {
                if (typeof entry === "string") return entry;
                if (entry && typeof entry === "object" && "type" in entry) {
                  const e = entry as { type: string; primary?: boolean };
                  return e.primary ? `${e.type}*` : e.type;
                }
                return String(entry);
              })
              .join(", ");
          },
        },
        { key: "phone", header: "Phone", width: 18 },
      ];

      output(result.content, {
        format: ctx.outputFormat,
        columns,
        emptyState: {
          headline: `No contacts found at ${company.name}.`,
          reasons: ["This company has no contacts recorded yet."],
          // `contacts create` needs an email + first/last name that the
          // user has to provide — surfaced as an affordance pointer below
          // the headline instead of a copy-paste placeholder template.
        },
      });

      if (ctx.outputFormat === "table" && result.content.length > 0) {
        process.stderr.write(
          chalk.dim(`\n  ${result.content.length} contacts at ${company.name}\n`)
        );
        const first = result.content[0];
        // Pickable next steps. `contacts create` needs email + first/last
        // name from the user, so it can't be drilled into by number;
        // surfaced as an affordance pointer below the pickable list.
        const steps: NextStep[] = [
          {
            key: "1",
            label: `${chalk.cyan(replCmd(`pax8 contacts show ${first.id}`))}  ${chalk.dim("view contact details")}`,
            command: ["contacts", "show", String(first.id)],
          },
          {
            key: "2",
            label: `${chalk.cyan(replCmd(`pax8 clients more "${company.name}"`))}  ${chalk.dim("view client summary")}`,
            command: ["clients", "more", company.name],
          },
        ];
        process.stderr.write(chalk.dim("\n  Try next:\n"));
        await promptNextSteps(steps, { renderList: true });
        process.stderr.write(
          chalk.dim(
            `  Add another contact — run ${chalk.cyan(replCmd("pax8 contacts create --help"))} for syntax.\n\n`,
          ),
        );
      }
    } catch (error) {
      await handleCommandError(error, spinner, "Failed to list contacts");
    }
  });

