// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getConfigDir, safeWriteFileSync } from "@pax8/core";

interface LastListEntry {
  index: number;
  id: string;
  name: string;
}

/**
 * #456: snapshot of the argv + paging state of the most recent list-style
 * command. Lets the REPL implement `back` / `n` / `p` so the user doesn't
 * have to retype `clients list --page 3` after drilling into a row.
 *
 * `command` is the argv WITHOUT the leading `pax8`; the REPL prepends it
 * via the same `node <cliPath> ...` spawn path as a normal typed command.
 */
export interface LastListContext {
  command: string[];
  page: { number: number; totalPages: number };
}

function filePath(): string {
  return path.join(getConfigDir(), "last-list.json");
}

function contextPath(): string {
  return path.join(getConfigDir(), "last-list-context.json");
}

/**
 * Save a numbered list of resources so subsequent commands can reference by number.
 *
 * #469: routed through `safeWriteFileSync` so the file is created with mode
 * `0o600` atomically and refuses to follow a symlink at the destination.
 * Partner-tenant business data (company names + IDs) lives in this cache; on
 * a shared host or CI runner the default umask would otherwise leave it
 * world-readable.
 */
export async function saveLastList(items: LastListEntry[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(filePath()), { recursive: true });
    safeWriteFileSync(filePath(), JSON.stringify(items));
  } catch {
    // Non-fatal — don't break the CLI if cache write fails
  }
}

/**
 * #456: persist the command + paging state that produced the most recent
 * list. Lets the REPL implement `back` / `n` / `p` without making the
 * user retype `--page N` flags. Best-effort — failure to write doesn't
 * break the list command.
 *
 * Same safe-write posture as `saveLastList` (`safeWriteFileSync`,
 * mode `0o600`, refuses to follow a symlink).
 */
export async function saveLastListContext(ctx: LastListContext): Promise<void> {
  try {
    await fs.mkdir(path.dirname(contextPath()), { recursive: true });
    safeWriteFileSync(contextPath(), JSON.stringify(ctx));
  } catch {
    // Non-fatal — don't break the CLI if cache write fails.
  }
}

/**
 * Load the most recent list-context snapshot, or `null` if it doesn't
 * exist / is corrupt / fails shape validation. Shape-validates the
 * contents defensively — a tampered file should never let a typed
 * `n` / `p` / `back` execute an unexpected argv.
 */
export async function loadLastListContext(): Promise<LastListContext | null> {
  try {
    const content = await fs.readFile(contextPath(), "utf-8");
    const raw = JSON.parse(content) as Record<string, unknown>;
    if (
      !raw ||
      typeof raw !== "object" ||
      !Array.isArray(raw.command) ||
      !raw.command.every((s) => typeof s === "string") ||
      raw.command.length === 0 ||
      typeof raw.page !== "object" ||
      raw.page === null ||
      typeof (raw.page as Record<string, unknown>).number !== "number" ||
      typeof (raw.page as Record<string, unknown>).totalPages !== "number"
    ) {
      return null;
    }
    return raw as unknown as LastListContext;
  } catch {
    return null;
  }
}

/**
 * #456: rewrite the saved list-command argv to target a specific page
 * number. Replaces any existing `--page <n>` pair; appends one when the
 * saved command didn't carry an explicit `--page` (the default page is
 * 1, which the user never types, so navigating from page 1 → page 2
 * needs the flag to be inserted).
 *
 * Returns a new argv — does not mutate the input.
 */
export function rewriteArgvForPage(command: string[], targetPage: number): string[] {
  const out: string[] = [];
  let replaced = false;
  for (let i = 0; i < command.length; i++) {
    if (command[i] === "--page" && i + 1 < command.length) {
      out.push("--page", String(targetPage));
      i++;
      replaced = true;
    } else {
      out.push(command[i]);
    }
  }
  if (!replaced) {
    out.push("--page", String(targetPage));
  }
  return out;
}

/**
 * Resolve a user input that could be a number (#), UUID, or name.
 * Returns the ID if found, or the original input if not a number.
 */
export async function resolveFromLastList(input: string): Promise<{ id: string; name: string } | null> {
  const num = parseInt(input, 10);
  if (isNaN(num) || String(num) !== input.trim()) return null;

  try {
    const content = await fs.readFile(filePath(), "utf-8");
    const items: LastListEntry[] = JSON.parse(content);
    const match = items.find((i) => i.index === num);
    if (match) return { id: match.id, name: match.name };
  } catch {
    // Cache doesn't exist or is corrupt
  }
  return null;
}
