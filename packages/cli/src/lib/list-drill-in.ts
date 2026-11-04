// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { getConfigDir, safeWriteFileSync } from "@pax8/core";
import { mkdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { saveLastList } from "./last-list.js";
import { promptNextSteps, type NextStep } from "./next-step.js";

/**
 * #418: shared pickable-drill-in wiring for list commands.
 *
 * After a list command renders, partners can type a row number at the
 * REPL prompt to drill into that row's detail view. This requires three
 * pieces of state to land in `~/.pax8/`:
 *
 * 1. `last-list.json` — the index→{id,name} lookup `resolveFromLastList`
 *    uses when commands like `clients show 3` are typed.
 * 2. `pending-actions.json` — the key→command lookup the REPL's bare-
 *    number-input branch reads (`packages/cli/src/lib/repl.ts:111-160`).
 * 3. `promptNextSteps` — the inline TTY prompt rendered after the table
 *    so the user can pick by number in a single terminal session.
 *
 * `clients list` (`packages/cli/src/commands/companies/list.ts`) shipped
 * this pattern; this helper extracts it so `subscriptions / orders /
 * invoices / quotes list` can wire in with a single call rather than
 * copy-pasting ~30 lines four times.
 *
 * All writes are best-effort and silently swallow errors — a cache
 * write must never block the actual list output.
 */
export interface DrillInRow {
  /** Stable row ID used for `<resource> show <id>` lookups. */
  id: string;
}

export interface WireListDrillInOptions<T extends DrillInRow> {
  rows: readonly T[];
  /** Spec resource name (`subscriptions`, `orders`, `invoices`, `quotes`). */
  resource: string;
  /**
   * Row index offset so page-2 numbering continues from 26 rather than
   * restarting at 1. Caller computes as `apiPage * pageSize`.
   */
  startNum: number;
  /**
   * Resolve a human-friendly label for the row — surfaces in the
   * promptNextSteps prompt as the sample row hint. Typically a
   * combination of company + product / total / status.
   */
  getLabel: (row: T) => string;
}

/**
 * Persist drill-in state + render the pickable prompt. Caller is
 * responsible for the table render itself; this only handles the
 * post-table wiring. Calls `promptNextSteps` last, which short-circuits
 * when stdin is not a TTY (piped / agent invocations see no prompt).
 */
export async function wireListDrillIn<T extends DrillInRow>(
  options: WireListDrillInOptions<T>,
): Promise<void> {
  const { rows, resource, startNum, getLabel } = options;
  if (rows.length === 0) return;

  // (1) last-list.json — index→{id,name} lookup.
  await saveLastList(
    rows.map((row, i) => ({
      index: startNum + i + 1,
      id: String(row.id),
      name: getLabel(row),
    })),
  );

  // (2) pending-actions.json — REPL bare-number-input lookup. Each entry's
  // `command` is interpreted by `lib/repl.ts:177-227` as a templated
  // command to run when the user types the matching key.
  //
  // The `pax8 ` prefix is load-bearing: the REPL dispatch check at
  // repl.ts:191 is `/^pax8\s+\w/.test(picked.command)` (defense-in-depth
  // against a tampered pending-actions.json from #506). Without the
  // prefix the regex fails, the dispatch silently no-ops, and the bare-
  // number drill-in stays dead.
  try {
    const dir = getConfigDir();
    mkdirSync(dir, { recursive: true });
    safeWriteFileSync(
      pathJoin(dir, "pending-actions.json"),
      JSON.stringify(
        rows.map((row, i) => ({
          key: String(startNum + i + 1),
          command: `pax8 ${resource} show ${String(row.id)}`,
        })),
      ),
    );
  } catch {
    // Best-effort — never block list rendering on a cache write failure.
  }

  // (3) promptNextSteps — inline TTY prompt for drill-in. No-ops outside
  // a TTY, so subprocess / agent invocations see nothing on stderr.
  const steps: NextStep[] = rows.map((row, i) => ({
    key: String(startNum + i + 1),
    label: getLabel(row),
    command: [resource, "show", String(row.id)],
  }));
  await promptNextSteps(steps);
}
