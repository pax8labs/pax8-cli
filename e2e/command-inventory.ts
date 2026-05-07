// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Single source of truth for every CLI command + its per-command e2e spec.
 *
 * Each entry declares what "good behavior" looks like for that command:
 * - Can it run without crashing under PAX8_DEMO=1?
 * - For list commands: minimum row count from demo fixtures
 * - For show commands: how to resolve a real ID at test time
 * - Required fragments in human output (semantic invariants)
 * - JSON contract: required fields in --json output
 * - Whether to skip the live run (interactive, destructive, etc.)
 *
 * This file IS the spec. When a new command is added to the CLI, add it
 * here too — the per-command matrix will then exercise it automatically.
 *
 * Cataloguing failures: if a command is currently broken (e.g. `usage list`
 * 404, `orders show` Company:undefined), set `demo.knownBroken` with the
 * issue link rather than asserting around the bug. The matrix will then
 * `it.skip` the affected layers and emit a console warning, so the bug
 * stays visible without painting over it.
 */
import type { CliResult } from "./test-utils.js";

export type CommandType =
  | "list"
  | "show"
  | "action"
  | "report"
  | "diagnostic"
  | "auth"
  | "meta";

export interface DemoSpec {
  /** For list commands: --json output must contain ≥ minRows entries. */
  minRows?: number;
  /** Strings/regex fragments that MUST appear in human (no --json) output. */
  expectedFragments?: (string | RegExp)[];
  /** Strings that MUST NOT appear in human output (in addition to the global banlist). */
  forbiddenFragments?: string[];
  /**
   * If the command is currently broken in demo mode. Set this rather than
   * weakening assertions — the matrix will skip layers that depend on a
   * working run and emit a console.warn so the regression stays visible.
   */
  knownBroken?: { issue: string; reason: string };
}

export interface JsonContract {
  /** For list-shaped output: each entry must contain these keys. */
  arrayItemRequiredFields?: string[];
  /** For object-shaped output: top-level required keys. */
  objectRequiredFields?: string[];
  /** Skip JSON contract check (e.g. command produces no JSON). */
  skip?: { reason: string };
}

export interface CommandSpec {
  /** Args after `pax8` in argv. Used as test ID and runtime args. */
  command: string[];
  /** Group name (companies, orders, etc.) for test grouping. */
  group: string;
  /** Display name for failure messages. */
  label?: string;
  type: CommandType;
  /** True if this command mutates state (will only run --help in matrix). */
  isWrite?: boolean;
  /**
   * If the command needs a real ID, resolve it at test time.
   * Returns the full args (e.g. ["orders", "show", "<resolved-id>"]).
   * Cached per resolveArgsKey to avoid re-resolving.
   */
  resolveArgs?: () => Promise<string[]>;
  resolveArgsKey?: string;
  /** Skip the live-run layers (smoke / invariants / semantic). Help still runs. */
  skipLiveRun?: { reason: string };
  demo: DemoSpec;
  jsonContract: JsonContract;
  /** Per-command extra assertions. Receives stripped combined human output. */
  customAssertions?: (humanOut: string, r: CliResult) => void;
}

// ─── ID resolvers ────────────────────────────────────────────────────────────
//
// Show commands need a real resource ID. We resolve them by running the
// corresponding `<group> list --json` and grabbing the first item's id.
// Resolutions are cached per key so we only pay the cost once per group.

const idCache = new Map<string, string>();

async function resolveFirstId(
  group: string,
  listArgs: string[],
  jsonField = "id"
): Promise<string> {
  const cacheKey = `${group}:${listArgs.join(" ")}:${jsonField}`;
  const hit = idCache.get(cacheKey);
  if (hit) return hit;
  const { runCli } = await import("./test-utils.js");
  const r = await runCli([...listArgs, "--json"]);
  if (r.exitCode !== 0) {
    throw new Error(
      `Failed to resolve ${group} ID via \`${listArgs.join(" ")} --json\`: exit ${r.exitCode}\nstderr: ${r.stderr}`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(
      `\`${listArgs.join(" ")} --json\` did not produce valid JSON.\nstdout (first 400 chars): ${r.stdout.slice(0, 400)}`
    );
  }
  // Envelope shape: { <thing>: [...], nextActions } OR flat array.
  let items: unknown;
  if (Array.isArray(parsed)) {
    items = parsed;
  } else if (parsed && typeof parsed === "object") {
    // Find the first array-valued field.
    items =
      (Object.values(parsed).find((v) => Array.isArray(v)) as unknown) ??
      undefined;
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(
      `\`${listArgs.join(" ")} --json\` returned no rows; cannot resolve ${group} ID`
    );
  }
  const first = items[0] as Record<string, unknown>;
  const id = first[jsonField];
  if (typeof id !== "string" || !id) {
    throw new Error(
      `First ${group} row had no string \`${jsonField}\` field. Row: ${JSON.stringify(first).slice(0, 200)}`
    );
  }
  idCache.set(cacheKey, id);
  return id;
}

// ─── Inventory ───────────────────────────────────────────────────────────────

export const COMMAND_INVENTORY: CommandSpec[] = [
  // ── auth ──────────────────────────────────────────────────────────────────
  {
    command: ["auth", "login"],
    group: "auth",
    type: "auth",
    isWrite: true,
    skipLiveRun: { reason: "interactive: prompts for token / opens browser" },
    demo: {},
    jsonContract: { skip: { reason: "interactive command" } },
  },
  {
    command: ["auth", "logout"],
    group: "auth",
    type: "auth",
    isWrite: true,
    skipLiveRun: { reason: "destructive: clears local credentials" },
    demo: {},
    jsonContract: { skip: { reason: "side-effect command" } },
  },
  {
    command: ["auth", "status"],
    group: "auth",
    type: "auth",
    demo: {
      // Under PAX8_DEMO=1 this should report demo mode somewhere in output.
      expectedFragments: [/demo|not authenticated|authenticated/i],
    },
    jsonContract: { objectRequiredFields: ["authenticated", "mode"] },
  },
  // ── config ────────────────────────────────────────────────────────────────
  {
    command: ["config", "show"],
    group: "config",
    type: "meta",
    demo: {},
    jsonContract: { skip: { reason: "config output is freeform" } },
  },
  {
    command: ["config", "path"],
    group: "config",
    type: "meta",
    demo: {
      expectedFragments: [/\.pax8|\/pax8|config/i],
    },
    jsonContract: { skip: { reason: "prints a single path" } },
  },
  {
    command: ["config", "init"],
    group: "config",
    type: "meta",
    isWrite: true,
    skipLiveRun: { reason: "interactive: prompts to overwrite" },
    demo: {},
    jsonContract: { skip: { reason: "interactive command" } },
  },
  {
    command: ["config", "set"],
    group: "config",
    type: "meta",
    isWrite: true,
    skipLiveRun: { reason: "needs key=value args + writes config" },
    demo: {},
    jsonContract: { skip: { reason: "side-effect command" } },
  },
  // ── companies ─────────────────────────────────────────────────────────────
  {
    command: ["companies", "list"],
    group: "companies",
    type: "list",
    demo: {
      minRows: 6,
      expectedFragments: ["Acme Corp"],
    },
    jsonContract: {
      arrayItemRequiredFields: ["id", "name"],
    },
  },
  {
    command: ["companies", "show", "Acme Corp"],
    group: "companies",
    label: 'companies show "Acme Corp"',
    type: "show",
    demo: {
      expectedFragments: ["Acme Corp"],
    },
    jsonContract: {
      objectRequiredFields: ["id", "name"],
    },
  },
  {
    command: ["companies", "more", "Acme Corp"],
    group: "companies",
    label: 'companies more "Acme Corp"',
    type: "list",
    demo: {
      expectedFragments: ["Acme Corp"],
    },
    jsonContract: { skip: { reason: "freeform multi-section render" } },
  },
  {
    command: ["companies", "create"],
    group: "companies",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "create flow needs --name + confirm prompt" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["companies", "update"],
    group: "companies",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "update flow needs id + fields + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── products ──────────────────────────────────────────────────────────────
  {
    command: ["products", "list"],
    group: "products",
    type: "list",
    demo: { minRows: 10 },
    jsonContract: { arrayItemRequiredFields: ["id", "name"] },
  },
  {
    command: ["products", "search", "microsoft"],
    group: "products",
    type: "list",
    demo: { minRows: 1 },
    jsonContract: { arrayItemRequiredFields: ["id", "name"] },
  },
  {
    command: ["products", "show"],
    group: "products",
    type: "show",
    resolveArgsKey: "products:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("products", ["products", "list"]);
      return ["products", "show", id];
    },
    demo: {
      knownBroken: {
        issue: "#208",
        reason:
          "show commands return [{...}] (array of one) instead of the single object — JSON-shape inconsistency",
      },
    },
    jsonContract: { objectRequiredFields: ["id", "name"] },
  },
  // ── subscriptions ─────────────────────────────────────────────────────────
  {
    command: ["subscriptions", "list"],
    group: "subscriptions",
    type: "list",
    demo: {
      minRows: 19,
      // Must enrich product/company so the table is readable.
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["subscriptions", "show"],
    group: "subscriptions",
    type: "show",
    resolveArgsKey: "subscriptions:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("subscriptions", ["subscriptions", "list"]);
      return ["subscriptions", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#208",
        reason: "show JSON returns array-of-1 instead of single object",
      },
    },
    jsonContract: { objectRequiredFields: ["id"] },
  },
  {
    command: ["subscriptions", "renewals", "--within", "30d"],
    group: "subscriptions",
    type: "list",
    demo: {},
    jsonContract: { skip: { reason: "renewals envelope varies" } },
  },
  {
    command: ["subscriptions", "update"],
    group: "subscriptions",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "update needs id + fields + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["subscriptions", "cancel"],
    group: "subscriptions",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "cancel needs id + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── orders ────────────────────────────────────────────────────────────────
  {
    command: ["orders", "list"],
    group: "orders",
    type: "list",
    demo: {
      minRows: 5,
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["orders", "show"],
    group: "orders",
    type: "show",
    resolveArgsKey: "orders:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("orders", ["orders", "list"]);
      return ["orders", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
    },
    jsonContract: {
      objectRequiredFields: ["id", "companyId", "companyName", "lineItems"],
    },
  },
  {
    command: ["orders", "create"],
    group: "orders",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs --company/--product + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── invoices ──────────────────────────────────────────────────────────────
  {
    command: ["invoices", "list"],
    group: "invoices",
    type: "list",
    demo: { minRows: 14, forbiddenFragments: ["undefined"] },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["invoices", "show"],
    group: "invoices",
    type: "show",
    resolveArgsKey: "invoices:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("invoices", ["invoices", "list"]);
      return ["invoices", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#208",
        reason: "show JSON returns array-of-1 instead of single object",
      },
    },
    jsonContract: { objectRequiredFields: ["id"] },
  },
  {
    command: ["invoices", "items"],
    group: "invoices",
    type: "show",
    resolveArgsKey: "invoices:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("invoices", ["invoices", "list"]);
      return ["invoices", "items", id];
    },
    demo: { forbiddenFragments: ["undefined"] },
    jsonContract: { skip: { reason: "items envelope varies" } },
  },
  {
    command: ["invoices", "audit"],
    group: "invoices",
    type: "report",
    demo: {
      // Variety check is enforced by customAssertions below.
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { skip: { reason: "audit envelope varies" } },
    customAssertions: (out) => {
      // The audit should surface at least one discrepancy of any kind, otherwise
      // the demo data is too thin to demonstrate the feature. Tighter checks
      // (≥3 discrepancies of ≥2 types) belong with the demo-data audit (#196).
      // Don't fail loudly here — just warn — so the matrix doesn't block on
      // a fixture-quality concern that's tracked separately.
      const hasDiscrepancy = /discrep|overcharge|undercharge|orphan|mismatch/i.test(
        out
      );
      if (!hasDiscrepancy) {
        // eslint-disable-next-line no-console
        console.warn(
          "  [warn] invoices audit produced no visible discrepancies — fixture may be too thin (#196)"
        );
      }
    },
  },
  {
    command: ["invoices", "dispute"],
    group: "invoices",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs --discrepancy + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── contacts ──────────────────────────────────────────────────────────────
  // Contacts API is scoped per-company by design — bare `contacts list` errors
  // intentionally with a hint to pass --company. The inventory targets Summit
  // Healthcare (which has demo contacts); Acme Corp has none in current
  // fixtures (#196 demo-data audit will close that gap).
  {
    command: ["contacts", "list", "--company", "Summit Healthcare Partners"],
    group: "contacts",
    label: "contacts list --company Summit Healthcare",
    type: "list",
    demo: { minRows: 1, forbiddenFragments: ["undefined"] },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["contacts", "show"],
    group: "contacts",
    type: "show",
    resolveArgsKey: "contacts:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("contacts", [
        "contacts",
        "list",
        "--company",
        "Summit Healthcare Partners",
      ]);
      return ["contacts", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#208",
        reason: "show JSON returns array-of-1 instead of single object",
      },
    },
    jsonContract: { objectRequiredFields: ["id"] },
  },
  {
    command: ["contacts", "create"],
    group: "contacts",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs --company + --name + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["contacts", "update"],
    group: "contacts",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs id + fields + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["contacts", "delete"],
    group: "contacts",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "destructive + needs confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── quotes ────────────────────────────────────────────────────────────────
  {
    command: ["quotes", "list"],
    group: "quotes",
    type: "list",
    demo: { minRows: 3, forbiddenFragments: ["undefined"] },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["quotes", "show"],
    group: "quotes",
    type: "show",
    resolveArgsKey: "quotes:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("quotes", ["quotes", "list"]);
      return ["quotes", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#208",
        reason: "show JSON returns array-of-1 instead of single object",
      },
    },
    jsonContract: { objectRequiredFields: ["id"] },
  },
  {
    command: ["quotes", "create"],
    group: "quotes",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs --company + items + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["quotes", "update"],
    group: "quotes",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs id + fields + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["quotes", "delete"],
    group: "quotes",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "destructive + needs confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  // ── webhooks ──────────────────────────────────────────────────────────────
  {
    command: ["webhooks", "list"],
    group: "webhooks",
    type: "list",
    demo: { minRows: 3, forbiddenFragments: ["undefined"] },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["webhooks", "logs"],
    group: "webhooks",
    type: "list",
    resolveArgsKey: "webhooks:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("webhooks", ["webhooks", "list"]);
      return ["webhooks", "logs", id];
    },
    demo: { forbiddenFragments: ["undefined"] },
    jsonContract: { skip: { reason: "logs envelope varies" } },
  },
  {
    command: ["webhooks", "create"],
    group: "webhooks",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "needs --url + --topics + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["webhooks", "delete"],
    group: "webhooks",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "destructive + needs confirm" },
    demo: {},
    jsonContract: { skip: { reason: "write command" } },
  },
  {
    command: ["webhooks", "test"],
    group: "webhooks",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "fires a real test event; needs id" },
    demo: {},
    jsonContract: { skip: { reason: "side-effect command" } },
  },
  // ── recommendations ───────────────────────────────────────────────────────
  {
    command: ["recommendations", "list"],
    group: "recommendations",
    type: "list",
    demo: {
      forbiddenFragments: ["undefined"],
    },
    // Recommendations are computed (not stored entities) so they don't have
    // a stable `id` — the contract is the company they apply to + the type.
    jsonContract: {
      arrayItemRequiredFields: ["companyId", "companyName", "type"],
    },
    customAssertions: (out, r) => {
      // Triple-print check (#192-adjacent): each recommendation row should
      // appear once, not multiple times. Heuristic: count distinct ID
      // appearances vs row count from JSON.
      // (Lighter version — just warn if repetition is suspicious.)
      const dupCheck = out.match(/coverage gap|underutilized|opportunity/gi) ?? [];
      if (dupCheck.length > 30) {
        // eslint-disable-next-line no-console
        console.warn(
          `  [warn] recommendations list output has ${dupCheck.length} keyword hits — possible duplicate render`
        );
      }
    },
  },
  {
    command: ["recommendations", "act"],
    group: "recommendations",
    type: "action",
    isWrite: true,
    skipLiveRun: { reason: "interactive: numbered selection + confirm" },
    demo: {},
    jsonContract: { skip: { reason: "interactive command" } },
  },
  // ── report ────────────────────────────────────────────────────────────────
  {
    command: ["report", "mrr"],
    group: "report",
    type: "report",
    demo: {
      expectedFragments: [/MRR/],
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { skip: { reason: "report envelope varies" } },
  },
  {
    command: ["report", "growth"],
    group: "report",
    type: "report",
    demo: {
      expectedFragments: [/growth|MRR/i],
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { skip: { reason: "report envelope varies" } },
  },
  // ── usage ─────────────────────────────────────────────────────────────────
  {
    command: ["usage", "list"],
    group: "usage",
    type: "list",
    demo: {
      // 2 in current demo; #196 will grow it. Don't gate on minRows>2 yet.
      minRows: 2,
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#199-adjacent (real-API 404)",
        reason:
          "real-API run returned 404 Not Found 2026-05-06; demo path may also be thin (only 2 rows). Track separately.",
      },
    },
    jsonContract: { arrayItemRequiredFields: ["id"] },
  },
  {
    command: ["usage", "show"],
    group: "usage",
    type: "show",
    resolveArgsKey: "usage:first",
    resolveArgs: async () => {
      const id = await resolveFirstId("usage", ["usage", "list"]);
      return ["usage", "show", id];
    },
    demo: {
      forbiddenFragments: ["undefined"],
      knownBroken: {
        issue: "#208",
        reason: "show JSON returns array-of-1 instead of single object",
      },
    },
    jsonContract: { objectRequiredFields: ["id"] },
  },
  // ── cost ──────────────────────────────────────────────────────────────────
  {
    command: [
      "cost",
      "sim",
      "--company",
      "Acme Corp",
      "--product",
      "Microsoft 365 Business Premium",
    ],
    group: "cost",
    label: "cost sim --company Acme --product M365 BP",
    type: "report",
    demo: { forbiddenFragments: ["undefined"] },
    jsonContract: { skip: { reason: "sim envelope varies" } },
  },
  // ── telemetry ─────────────────────────────────────────────────────────────
  {
    command: ["telemetry", "status"],
    group: "telemetry",
    type: "meta",
    demo: { expectedFragments: [/telemetry|enabled|disabled/i] },
    jsonContract: { skip: { reason: "freeform status output" } },
  },
  {
    command: ["telemetry", "enable"],
    group: "telemetry",
    type: "meta",
    isWrite: true,
    skipLiveRun: { reason: "writes config; tested separately" },
    demo: {},
    jsonContract: { skip: { reason: "side-effect command" } },
  },
  {
    command: ["telemetry", "disable"],
    group: "telemetry",
    type: "meta",
    isWrite: true,
    skipLiveRun: { reason: "writes config; tested separately" },
    demo: {},
    jsonContract: { skip: { reason: "side-effect command" } },
  },
  // ── root-level ────────────────────────────────────────────────────────────
  {
    command: ["status"],
    group: "root",
    type: "diagnostic",
    demo: {
      expectedFragments: [/MRR|customers|renewals/i],
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { skip: { reason: "status dashboard freeform" } },
  },
  {
    command: ["doctor"],
    group: "root",
    type: "diagnostic",
    demo: {
      expectedFragments: [/check|version|node/i],
      forbiddenFragments: ["undefined"],
    },
    jsonContract: { skip: { reason: "doctor freeform" } },
  },
  {
    command: ["init"],
    group: "root",
    type: "meta",
    isWrite: true,
    skipLiveRun: { reason: "interactive: prompts to overwrite config" },
    demo: {},
    jsonContract: { skip: { reason: "interactive command" } },
  },
  {
    command: ["version"],
    group: "root",
    type: "meta",
    demo: { expectedFragments: [/\d+\.\d+\.\d+/] },
    jsonContract: { skip: { reason: "single line" } },
  },
  {
    command: ["report-bug"],
    group: "root",
    type: "meta",
    // Bare `report-bug` requires a prior error in the session to report.
    // Run with no context, it exits 1 — arguably should fall back to help
    // text but that's a separate UX call (see #209). Skip the live run; the
    // help-flag layer still covers --help.
    skipLiveRun: {
      reason:
        "needs a prior error in session state; bare invocation exits 1 (see #209)",
    },
    demo: {},
    jsonContract: { skip: { reason: "freeform / contextual output" } },
  },
];

/**
 * Sanity check at module load: every command has a unique args path. Catches
 * accidental duplicate entries when the inventory grows.
 */
const seen = new Set<string>();
for (const spec of COMMAND_INVENTORY) {
  const key = spec.command.join(" ");
  if (seen.has(key)) {
    throw new Error(`Duplicate command in inventory: \`pax8 ${key}\``);
  }
  seen.add(key);
}
