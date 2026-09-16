// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Emitted-action contract (#708).
 *
 * Several commands suggest what to do next: `nextActions[]` on list and
 * summary commands, `items[].action` on `today`, `orderArgs` on
 * `recommendations list`. Two properties of those payloads are
 * load-bearing for agent runtimes, and both used to be inconsistent.
 *
 * **1. Every action needs a spawn-safe argv.** `command` is a display
 * string that interpolates user-supplied values — company names, product
 * names — and is unsafe to hand to a shell (#462, #562). Agents must
 * spawn `args.slice(1)`. Before #708, `args` was missing on `dashboard`,
 * `invoices audit`, `cost sim`, and `subscriptions renewals`, which left
 * an agent following the contract with nothing to spawn and a string it
 * was explicitly told never to tokenize. `cost sim` was the sharp edge:
 * its only suggestion interpolates a partner-controlled company name.
 *
 * **2. Every action needs to say whether it writes.** Read commands
 * routinely suggest writes — `invoices audit` emits five
 * `invoices dispute` calls, `today` emits `orders create` and
 * `recommendations act`. Nothing in the payload distinguished those from
 * the harmless suggestions beside them, so an agent had to match the
 * command string against a prose table in the skill to decide whether it
 * needed approval. That is exactly the inference that fails quietly, and
 * the failure places real orders.
 *
 * `isWrite` moves that decision out of documentation and into the data.
 * The agent rule collapses to one line: never spawn an action with
 * `isWrite: true` without explicit user approval.
 *
 * Build every action through `buildAction()` so the three fields cannot
 * drift apart — `command` is derived from the same argv the agent runs,
 * rather than hand-written alongside it.
 */

import { displayCommandFromArgs } from "./output.js";

export interface EmittedAction {
  /**
   * Human-readable rendering of `args`. DISPLAY ONLY — never tokenize it
   * or pass it to a shell. Derived from `args`, so the two cannot
   * disagree about what would run.
   */
  command: string;
  /** argv to spawn. `args[0]` is always `"pax8"`; spawn `args.slice(1)`. */
  args: string[];
  /** One-line explanation of why this action is being suggested. */
  description: string;
  /**
   * Whether running this mutates state — Pax8 API state or the local
   * machine. `true` means the caller must obtain explicit user approval
   * before spawning it, regardless of which command emitted it.
   */
  isWrite: boolean;
}

/**
 * Command paths that mutate state, as space-joined subcommand chains.
 *
 * Mirrors the "Write commands" half of the safety contract in
 * `packages/claude-skill/skill.md`. A contract test asserts the two stay
 * in step, because a command missing here is one an agent would run
 * without asking.
 *
 * Local-machine mutations are included alongside API writes: `demo on`
 * changes whether every later command hits the live API, and `config set`
 * / `auth logout` / `cache clear` all change state the partner owns.
 */
export const WRITE_COMMAND_PATHS: ReadonlySet<string> = new Set([
  // ── Pax8 API state ──
  "orders create",
  "invoices dispute",
  "clients create",
  "clients update",
  "contacts create",
  "contacts update",
  "contacts delete",
  "quotes create",
  "quotes update",
  "quotes delete",
  "quotes send",
  "quotes line-items add",
  "quotes line-items remove",
  "subscriptions update",
  "subscriptions cancel",
  "recommendations act",
  "webhooks create",
  "webhooks update",
  "webhooks delete",
  "webhooks enable",
  "webhooks disable",
  "webhooks test",
  "webhooks logs retry",
  // ── Local machine state ──
  "auth login",
  "auth logout",
  "config init",
  "config set",
  "demo on",
  "demo off",
  "cache clear",
  "telemetry enable",
  "telemetry disable",
  "init",
  "upgrade",
  "report-bug",
]);

/**
 * Longest subcommand chain in `WRITE_COMMAND_PATHS` (`quotes line-items
 * add`). Bounds how deep `isWriteCommand` needs to look.
 */
const MAX_PATH_DEPTH = 3;

/**
 * Decide whether an argv describes a write.
 *
 * Walks the leading non-flag tokens — so `["pax8", "orders", "create",
 * "--company", "Acme"]` resolves to `"orders create"` — and tests each
 * prefix against `WRITE_COMMAND_PATHS`. Prefix matching (rather than
 * exact) means `quotes line-items add` is caught at depth 3 while
 * `orders create` is caught at depth 2.
 *
 * `--dry-run` is deliberately NOT treated as making a write safe. A
 * dry-run order still warrants the same agent-side care, and honouring
 * the flag here would make the safety of an action depend on a flag a
 * caller could drop while copying it.
 */
export function isWriteCommand(args: readonly string[]): boolean {
  const tokens: string[] = [];
  for (const arg of args) {
    if (arg === "pax8") continue;
    if (arg.startsWith("-")) break;
    tokens.push(arg);
    if (tokens.length >= MAX_PATH_DEPTH) break;
  }
  for (let depth = 1; depth <= tokens.length; depth++) {
    if (WRITE_COMMAND_PATHS.has(tokens.slice(0, depth).join(" "))) return true;
  }
  return false;
}

/**
 * Build a complete emitted action from the argv an agent would run.
 *
 * `argv` may omit the leading `"pax8"`; it is added if absent so callers
 * can write `buildAction(["invoices", "dispute", "--discrepancy", id], …)`
 * without repeating it.
 */
export function buildAction(
  argv: readonly string[],
  description: string,
): EmittedAction {
  const args = argv[0] === "pax8" ? [...argv] : ["pax8", ...argv];
  return {
    command: displayCommandFromArgs(args),
    args,
    description,
    isWrite: isWriteCommand(args),
  };
}
