// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import chalk from "chalk";
import type { Command } from "commander";
import { resolve as resolvePath } from "node:path";
import { showWelcomeScreen } from "./welcome.js";

/**
 * Resolve the path the REPL passes to `node` when spawning child processes
 * for typed commands. Must be the same script node was invoked with —
 * `process.argv[1]`.
 *
 * Why not `import.meta.url`-based resolution: tsup inlines this module
 * into `dist/index.js`, so at runtime `import.meta.url` points at the
 * bundled file (not the source file's location). Any relative-path math
 * on that escapes the dist/ directory and global installs crash with
 * MODULE_NOT_FOUND on every typed command.
 *
 * Exported for unit tests.
 */
export function resolveCliPath(scriptPath: string | undefined): string {
  if (!scriptPath) {
    throw new Error(
      "REPL: cannot determine CLI entry point (process.argv[1] is empty)",
    );
  }
  return resolvePath(scriptPath);
}

/**
 * Tokenize a command line string, respecting quoted strings.
 * "companies more "Acme Corp" --json" -> ["companies", "more", "Acme Corp", "--json"]
 */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote: string | null = null;

  for (const ch of input) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (ch === " " || ch === "\t") {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

export async function startRepl(createProgram: () => Command): Promise<void> {
  const { createInterface } = await import("node:readline");
  const { spawn } = await import("node:child_process");
  const { join: pathJoin } = await import("node:path");
  const fs = await import("node:fs");
  const { homedir } = await import("node:os");

  const cliPath = resolveCliPath(process.argv[1]);

  showWelcomeScreen();
  process.stdout.write(chalk.dim("  Type a command, or ") + chalk.cyan("help") + chalk.dim(" / ") + chalk.cyan("exit") + "\n\n");

  const rl = createInterface({
    input: process.stdin,
    output: process.stderr,
    prompt: chalk.cyan.bold("pax8> "),
    terminal: process.stdin.isTTY ?? false,
  });

  rl.prompt();

  rl.on("line", (line: string) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "exit" || input === "quit" || input === "q") {
      rl.close();
      return;
    }

    if (input === "help") {
      const prog = createProgram();
      prog.outputHelp();
      process.stdout.write("\n");
      rl.prompt();
      return;
    }

    let args = tokenize(input);
    if (args[0] === "pax8") {
      args.shift();
    }

    // Handle bare number input — check for pending actions from last list/recommendations
    if (args.length === 1 && /^\d+$/.test(args[0])) {
      try {
        const actionsPath = pathJoin(homedir(), ".pax8", "pending-actions.json");
        const raw = JSON.parse(fs.readFileSync(actionsPath, "utf-8"));
        // Validate shape before trusting — prevent command injection via file tampering
        const actions = Array.isArray(raw) ? raw.filter(
          (a: unknown): a is { key: string; command?: string; rec?: { orderCommand?: string; suggestedProducts?: string[] } } =>
            typeof a === "object" && a !== null &&
            typeof (a as Record<string, unknown>).key === "string" &&
            ((a as Record<string, unknown>).command === undefined || typeof (a as Record<string, unknown>).command === "string") &&
            ((a as Record<string, unknown>).rec === undefined || typeof (a as Record<string, unknown>).rec === "object")
        ) : [];
        const picked = actions.find((a) => a.key === args[0]);
        if (picked) {
          if (picked.command && /^pax8\s+\w/.test(picked.command)) {
            // Generic command template (e.g. from companies list) — must start with "pax8 <subcommand>"
            args = tokenize(picked.command.replace(/^pax8\s+/, ""));
          } else if (picked.rec) {
            // Recommendation action
            if (picked.rec.orderCommand && /^pax8\s+orders\s+create\b/.test(picked.rec.orderCommand)) {
              // Only allow order create commands from recommendations
              args = tokenize(picked.rec.orderCommand.replace(/^pax8\s+/, ""));
            } else {
              const searchTerm = picked.rec.suggestedProducts?.[0] ?? "product";
              args = ["products", "search", searchTerm];
            }
          }
        }
      } catch { /* no pending actions */ }
    }

    // Run each command as a child process so it can never crash the REPL.
    // Use "inherit" for all stdio so the child gets the real TTY
    // (needed for table output detection and spinner animations).
    // Pause the REPL readline while the child runs so stdin input
    // (like "y" for confirmations) doesn't leak back to the REPL.
    rl.pause();
    const child = spawn("node", [cliPath, ...args], {
      env: { ...process.env, FORCE_COLOR: "1", PAX8_REPL: "1" },
      stdio: "inherit",
    });

    child.on("close", () => {
      process.stdout.write("\n");
      rl.resume();
      rl.prompt();
    });
  });

  return new Promise<void>((resolve) => {
    rl.on("close", () => {
      process.stdout.write(chalk.dim("\n  Goodbye.\n\n"));
      resolve();
    });
  });
}
