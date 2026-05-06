// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { Command } from "commander";
import chalk from "chalk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getConfigDir } from "@pax8/core";
import { confirm } from "../lib/confirm.js";
import { redactEnvelope, type BugReportEnvelope } from "../lib/redactor.js";

const execFileP = promisify(execFile);

const REPO = "pax8labs/pax8-cli";
const ISSUE_NEW_URL = `https://github.com/${REPO}/issues/new`;

/**
 * Path on disk where `handleCommandError` parks the most recent failure
 * envelope. Honors `PAX8_CONFIG_DIR` via `getConfigDir()` for test isolation.
 */
export function lastErrorPath(): string {
  return path.join(getConfigDir(), "last-error.json");
}

/**
 * Build the Markdown body of the GitHub issue from a redacted envelope.
 * Pure function so it's easy to test and reuse from the `--print` path.
 */
export function buildIssueBody(env: BugReportEnvelope): string {
  const sections: string[] = [];

  sections.push(`**Error code:** \`${env.code ?? "ERROR"}\``);
  const versions = [
    env.cli_version ? `CLI ${env.cli_version}` : null,
    env.node_version ? `Node ${env.node_version}` : null,
    env.os ? `OS ${env.os}` : null,
  ].filter(Boolean);
  if (versions.length > 0) {
    sections.push(`**Environment:** ${versions.join(" · ")}`);
  }
  if (env.timestamp) {
    sections.push(`**When:** ${env.timestamp}`);
  }

  const flagPart =
    env.flags && env.flags.length > 0 ? env.flags.join(", ") : "none";
  sections.push(
    `**Command:** \`${env.command ?? "unknown"}\` (flags: ${flagPart})`
  );

  sections.push("");
  sections.push("### Message");
  sections.push(env.message);

  if (env.causes && env.causes.length > 0) {
    sections.push("");
    sections.push("### Causes");
    for (const c of env.causes) sections.push(`- ${c}`);
  }

  if (env.recoverySteps && env.recoverySteps.length > 0) {
    sections.push("");
    sections.push("### Recovery steps suggested by the CLI");
    for (const r of env.recoverySteps) sections.push(`- ${r}`);
  }

  if (env.docsUrl) {
    sections.push("");
    sections.push(`**Docs:** ${env.docsUrl}`);
  }

  sections.push("");
  sections.push("---");
  sections.push(
    "_Sanitized by `pax8 report-bug`. No IDs, names, paths, or credentials included._"
  );

  return sections.join("\n");
}

/**
 * Build the title from a redacted envelope. Truncates the message so the
 * title stays under GitHub's 256-char limit and looks reasonable in lists.
 */
export function buildIssueTitle(env: BugReportEnvelope): string {
  const code = env.code ?? "ERROR";
  const msg = (env.message ?? "").trim().split("\n")[0] ?? "";
  const truncated = msg.length > 60 ? msg.slice(0, 60).trimEnd() + "…" : msg;
  return `[${code}] ${truncated}`.trim();
}

/**
 * Cross-platform "open this URL in the user's default browser" using only
 * Node's built-in `child_process` — deliberately avoids the `open` npm
 * package since this is the only call site and the platform commands are
 * stable.
 */
async function openUrl(url: string): Promise<void> {
  const platform = process.platform;
  let cmd: string;
  let args: string[];
  if (platform === "darwin") {
    cmd = "open";
    args = [url];
  } else if (platform === "win32") {
    // `start` is a cmd.exe builtin; `""` is the empty title arg required when
    // the URL contains characters cmd would otherwise treat as a title.
    cmd = "cmd";
    args = ["/c", "start", "", url];
  } else {
    cmd = "xdg-open";
    args = [url];
  }
  await new Promise<void>((resolve) => {
    const child = spawn(cmd, args, {
      detached: true,
      stdio: "ignore",
    });
    child.on("error", () => resolve());
    child.unref();
    // Don't await — detached. Resolve next tick so the caller can return.
    setImmediate(resolve);
  });
}

/**
 * Returns true if `gh` is on PATH AND authenticated. We treat
 * "installed but not authenticated" as a fall-back-to-URL signal rather than
 * a hard failure so first-time reporters aren't blocked.
 */
async function ghReady(): Promise<boolean> {
  try {
    await execFileP("gh", ["--version"]);
  } catch {
    return false;
  }
  try {
    await execFileP("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

interface ReportBugOptions {
  yes?: boolean;
  print?: boolean;
  json?: boolean;
}

/**
 * `--json` is also defined as a global program option, which means Commander
 * consumes it before subcommand-level handlers see it. Read directly from
 * argv so `pax8 report-bug --json` reliably hits the JSON-envelope path.
 */
function jsonFlagInArgv(): boolean {
  return process.argv.includes("--json");
}

async function readEnvelope(): Promise<BugReportEnvelope | null> {
  const filePath = lastErrorPath();
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as BugReportEnvelope;
    if (typeof parsed.message !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function runReportBug(opts: ReportBugOptions): Promise<number> {
  const raw = await readEnvelope();
  if (!raw) {
    process.stderr.write(
      "No recent error found. Run a command that fails and try again.\n"
    );
    return 1;
  }

  const env = redactEnvelope(raw);

  if (opts.json || jsonFlagInArgv()) {
    process.stdout.write(JSON.stringify(env, null, 2) + "\n");
    return 0;
  }

  const title = buildIssueTitle(env);
  const body = buildIssueBody(env);

  if (opts.print) {
    process.stdout.write(`Title: ${title}\n\n`);
    process.stdout.write(body + "\n");
    return 0;
  }

  // Show what would be submitted before asking.
  process.stdout.write(chalk.bold("\n  Title: ") + title + "\n\n");
  process.stdout.write(body + "\n\n");

  const ok = opts.yes
    ? true
    : await confirm("Submit this issue?", { default: false });
  if (!ok) {
    process.stderr.write(chalk.dim("  Aborted. Nothing was sent.\n"));
    return 0;
  }

  if (await ghReady()) {
    try {
      const { stdout } = await execFileP("gh", [
        "issue",
        "create",
        "-R",
        REPO,
        "--title",
        title,
        "--body",
        body,
      ]);
      const trimmed = stdout.trim();
      if (trimmed) process.stdout.write(trimmed + "\n");
      return 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        chalk.yellow(`  gh issue create failed (${msg}); falling back to browser.\n`)
      );
      // fall through to URL flow
    }
  }

  const url = `${ISSUE_NEW_URL}?title=${encodeURIComponent(
    title
  )}&body=${encodeURIComponent(body)}`;
  process.stdout.write(
    chalk.dim("  Opening a prefilled GitHub issue in your browser…\n")
  );
  process.stdout.write(chalk.dim(`  If nothing opens, paste this URL:\n  ${url}\n`));
  await openUrl(url);
  return 0;
}

export function reportBugCommand(): Command {
  return new Command("report-bug")
    .description(
      "File a sanitized GitHub issue for the most recent error (opt-in, per-invocation)"
    )
    .option("-y, --yes", "skip the interactive [y/N] confirmation")
    .option("--print", "print the redacted Markdown body and exit (no submission)")
    .addHelpText(
      "after",
      `
Output:
  --json                         # print the structured (redacted) envelope as JSON and exit

Examples:
  pax8 report-bug                # interactive: review then confirm
  pax8 report-bug --print        # see exactly what would be submitted
  pax8 report-bug --json         # pipe the redacted envelope to jq / etc.
  pax8 report-bug -y             # submit without prompting`
    )
    .action(async (opts: ReportBugOptions) => {
      const exitCode = await runReportBug(opts);
      if (exitCode !== 0) process.exit(exitCode);
    });
}
