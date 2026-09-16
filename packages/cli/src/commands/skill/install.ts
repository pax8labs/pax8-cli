// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * `pax8 skill install` — put the agent safety contract where Claude Code
 * will actually read it (#720).
 *
 * A subcommand rather than a postinstall hook. A postinstall that writes
 * into `~/.claude` is invisible, fires on every CI install, and mutates a
 * directory owned by a different tool. Installing an instruction file that
 * governs whether an agent asks before placing orders should be a
 * deliberate act, which also makes it a **write** in the safety contract
 * (`packages/claude-skill/skill.md`), alongside `config set` and
 * `cache clear`.
 */

import { Command } from "commander";
import chalk from "chalk";
import { mkdirSync } from "node:fs";
import * as path from "node:path";
import { safeWriteFileSync, ERROR_INTERNAL, ERROR_INVALID_INPUT } from "@pax8/core";
import { CliError, handleCommandError } from "../../lib/errors.js";
import { confirm, replCmd } from "../../lib/confirm.js";
import { getOutputFormat } from "../../lib/context.js";
import { buildAction, type EmittedAction } from "../../lib/actions.js";
import { setTelemetryFields } from "../../lib/telemetry-context.js";
import {
  SKILL_META_FILE,
  classifyInstall,
  readInstalledSkill,
  readShippedSkill,
  skillInstallDir,
  skillInstallPath,
  summarizeDrift,
  type SkillInstallState,
  type SkillMeta,
  type SkillScope,
} from "../../lib/skill-asset.js";

// Build-time injected by tsup (see packages/cli/tsup.config.ts).
declare const __CLI_VERSION__: string;

function cliVersion(): string {
  return typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.1.0";
}

type InstallAction = "printed" | "unchanged" | "created" | "updated" | "cancelled";

interface InstallResult {
  scope: SkillScope;
  path: string;
  action: InstallAction;
  /** What was on disk before this run — `absent` for a fresh install. */
  previousState: SkillInstallState;
  cliVersion: string;
  checksum: string;
  /** Claude Code reads skills at session start; an open session won't see it. */
  restartRequired: boolean;
  nextActions: EmittedAction[];
}

export const skillInstallCommand = new Command("install")
  .description("Install the Claude Code skill (agent safety contract) for pax8")
  .option("--global", "Install for all projects — ~/.claude/skills/pax8/SKILL.md (default)")
  .option("--project", "Install for this project only — ./.claude/skills/pax8/SKILL.md")
  .option("--force", "Overwrite a locally modified copy")
  .option("--print", "Write the skill to stdout and exit — installs nothing")
  .option("-y, --yes", "Skip the confirmation prompt")
  .addHelpText(
    "after",
    `
Examples:
  pax8 skill install                    # install for all projects (prompts first)
  pax8 skill install --project          # install into ./.claude/skills/pax8/
  pax8 skill install --print | less     # read it before installing anything
  pax8 skill install --force -y         # overwrite a locally edited copy
  pax8 skill install --json             # machine-readable install report

The skill is the agent-facing safety contract: which commands are reads,
which are writes, and what has to be confirmed before an order is placed.
Claude Code loads skills at session start — start a new session afterwards.`,
  )
  .action(async (_options, command: Command) => {
    const allOpts = command.optsWithGlobals();
    const jsonMode = getOutputFormat(allOpts) === "json";

    try {
      const shipped = readShippedSkill();
      if (!shipped) {
        throw new CliError(
          "This installation of pax8-cli doesn't contain the Claude skill",
          [
            "`skill.md` ships inside the package; it's missing from this copy",
            "A build that skipped `scripts/bundle-skill.mjs` produces exactly this",
          ],
          [
            "Reinstall the CLI: npm install -g @pax8/cli",
            "If you're working in the repo, run: pnpm build",
          ],
          undefined,
          ERROR_INTERNAL,
        );
      }

      // --print is a read: it writes the skill to stdout and touches
      // nothing. Raw markdown regardless of --json so the documented
      // `pax8 skill install --print > SKILL.md` pipeline works.
      if (allOpts.print) {
        process.stdout.write(shipped.content);
        setTelemetryFields({ skill_action: "printed" });
        return;
      }

      if (allOpts.global && allOpts.project) {
        throw new CliError(
          "--global and --project are mutually exclusive",
          ["Both flags were passed; there's no single target to write to"],
          [
            "Pass --global to install for every project (the default)",
            "Pass --project to install into ./.claude/skills/pax8/ only",
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const scope: SkillScope = allOpts.project ? "project" : "global";
      const targetDir = skillInstallDir(scope);
      const targetPath = skillInstallPath(scope);
      const installed = readInstalledSkill(scope);
      const state = classifyInstall(installed, shipped.checksum);

      const emit = (action: InstallAction): void => {
        setTelemetryFields({
          skill_action: action,
          skill_scope: scope,
          skill_previous_state: state,
        });
        if (!jsonMode) return;
        const result: InstallResult = {
          scope,
          path: targetPath,
          action,
          previousState: state,
          cliVersion: cliVersion(),
          checksum: shipped.checksum,
          restartRequired: action === "created" || action === "updated",
          nextActions: [
            buildAction(
              ["doctor", "--json"],
              "Confirm the installed skill matches the one this CLI ships",
            ),
          ],
        };
        process.stdout.write(JSON.stringify(result, null, 2) + "\n");
      };

      // Already exactly what we ship — no prompt, no write, no churn.
      if (state === "current") {
        if (!jsonMode) {
          process.stdout.write(
            chalk.green("\n  ✓ ") +
              `The pax8 skill is already up to date (${scope}).\n` +
              chalk.dim(`    ${targetPath}\n\n`),
          );
        }
        emit("unchanged");
        return;
      }

      // A symlink is almost always deliberate — someone pointed the skill
      // at a checkout. `safeWriteFileSync` opens with O_NOFOLLOW and would
      // fail with a bare ELOOP, and silently replacing the link (even
      // under --force) would break whatever set it up. Say so instead.
      if (installed.isSymlink) {
        throw new CliError(
          `${targetPath} is a symlink — refusing to write through it`,
          ["Overwriting would either follow the link or silently replace it"],
          [
            `Inspect it: ls -l ${targetPath}`,
            `Remove it first if it's stale, then re-run ${replCmd("pax8 skill install")}`,
            `Or update whatever it points at: ${replCmd("pax8 skill install --print")} > <target>`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      if (state === "unreadable") {
        throw new CliError(
          `Can't read the installed skill at ${targetPath}`,
          [installed.readError ?? "The file exists but could not be read"],
          [
            `Check permissions on ${targetDir}`,
            `Or write it elsewhere: ${replCmd("pax8 skill install --print")} > <path>`,
          ],
          undefined,
          ERROR_INTERNAL,
        );
      }

      // A copy we can't prove we wrote may carry the partner's own edits.
      // Refusing is the safe default; --force is the deliberate override.
      if (state === "modified" && !allOpts.force) {
        const drift = installed.content
          ? summarizeDrift(shipped.content, installed.content)
          : "contents differ";
        throw new CliError(
          `${targetPath} differs from the skill this CLI ships and wasn't written by it`,
          [
            drift,
            installed.meta
              ? `Its provenance file records a different checksum — the file has been edited since ${replCmd("pax8 skill install")} wrote it`
              : `No ${SKILL_META_FILE} provenance file next to it, so the edits can't be attributed`,
          ],
          [
            `Review the difference first: ${replCmd("pax8 skill install --print")} > /tmp/pax8-skill.md && diff /tmp/pax8-skill.md ${targetPath}`,
            `Overwrite once you're satisfied: ${replCmd("pax8 skill install --force")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const verb = state === "absent" ? "Install" : "Overwrite";
      if (!jsonMode) {
        const provenance =
          state === "stale" && installed.meta
            ? `\n    ${chalk.dim("Replacing:")} copy written by pax8-cli ${installed.meta.cliVersion}`
            : "";
        process.stdout.write(
          chalk.bold(`\n  ${verb} the pax8 Claude Code skill\n\n`) +
            `    ${chalk.dim("Target:")}   ${targetPath}\n` +
            `    ${chalk.dim("Source:")}   pax8-cli ${cliVersion()} (${shipped.content.length.toLocaleString("en-US")} bytes)${provenance}\n\n`,
        );
      }

      // Same contract as `pax8 upgrade`: a required prompt with no TTY and
      // no --yes must error rather than fall through to its default. This
      // is the gate that stops an agent installing an instruction file the
      // partner never saw.
      const autoYes = !!allOpts.yes || process.env.PAX8_YES === "1";
      if (!autoYes && !process.stdin.isTTY) {
        throw new CliError(
          "Cannot install the skill without confirmation — stdin is not a TTY",
          [`Writing ${targetPath} needs a terminal to confirm`],
          [
            `Pass ${replCmd("--yes")} to install without prompting`,
            `Or inspect it first: ${replCmd("pax8 skill install --print")}`,
          ],
          undefined,
          ERROR_INVALID_INPUT,
        );
      }

      const ok = await confirm(`${verb} ${targetPath}?`, { default: true });
      if (!ok) {
        if (!jsonMode) process.stderr.write(chalk.yellow("  Cancelled.\n\n"));
        emit("cancelled");
        return;
      }

      mkdirSync(targetDir, { recursive: true });
      safeWriteFileSync(targetPath, shipped.content);
      const meta: SkillMeta = {
        source: "@pax8/cli",
        cliVersion: cliVersion(),
        installedAt: new Date().toISOString(),
        checksum: shipped.checksum,
      };
      safeWriteFileSync(
        path.join(targetDir, SKILL_META_FILE),
        JSON.stringify(meta, null, 2) + "\n",
      );

      if (!jsonMode) {
        process.stdout.write(
          chalk.green("  ✓ ") +
            `Skill ${state === "absent" ? "installed" : "updated"}.\n\n` +
            chalk.dim("    Claude Code loads skills at session start — start a new session to pick it up.\n\n"),
        );
      }
      emit(state === "absent" ? "created" : "updated");
    } catch (error) {
      await handleCommandError(error, undefined, "skill install");
    }
  });
