// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Agent-contract surface pinning (#704).
 *
 * Companion to `agent-contract-enums.test.ts` (#636). That file pins the
 * string *values* agents switch on. This one pins the three other things
 * an agent reads and we kept breaking silently:
 *
 *   1. **Command inventory.** Every user-facing command path must be
 *      documented in `packages/claude-skill/skill.md`. The skill's
 *      read/write safety contract is only a safety contract if it
 *      actually enumerates the commands that exist — `quotes send`,
 *      `webhooks enable|disable`, and `webhooks logs retry` all shipped
 *      as undocumented writes before this test existed.
 *
 *   2. **List-envelope keys.** Since #483 every `--json` list command
 *      emits `{ <resource>: [...], page: {...} }`. The docs claimed flat
 *      arrays for months, and `--with-actions` was documented as
 *      `{ items, nextActions }` — a key that has never existed.
 *
 *   3. **Documented field paths.** Recipes tell agents to lead with
 *      specific fields. `skill.md` pointed at `pax8MonthlyCost` and
 *      `totalMrrRenewing`; the CLI emits `monthlyCost.amount` and no
 *      renewal aggregate at all.
 *
 * Why each of these failed open rather than loud: a wrong key makes
 * `jq` return `null`, which an agent reads as "no data" and reports to
 * the partner as "you have no renewals." A test is the only thing that
 * can tell the difference.
 *
 * All assertions drive the built CLI under `PAX8_DEMO=1` — same posture
 * as every other subprocess test in this directory.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCli, runCliExpectSuccess } from "./test-utils.js";

// Repo root: this file is at packages/cli/src/__tests__/, so up four.
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SKILL_PATH = "packages/claude-skill/skill.md";
// The copy Claude Code actually loads when working inside this repo.
const INSTALLED_SKILL_PATH = ".claude/skills/pax8/SKILL.md";

function readSkill(): string {
  return readFileSync(join(REPO_ROOT, SKILL_PATH), "utf-8");
}

// ── Command-inventory discovery ──────────────────────────────────────────────
//
// We walk `--help` output rather than importing `createProgram()` from
// `../index.js`: that module calls `main()` at import time, so pulling it
// into a test process would execute the CLI. Walking help output also has
// the virtue of pinning what a *user* can actually reach, which is the
// surface the skill is meant to describe.

/** Commands intentionally absent from the skill — with a reason each. */
const INVENTORY_EXEMPT = new Set<string>([
  // Easter eggs; registered hidden, excluded from help output anyway.
  // Listed defensively in case someone un-hides one.
  "moo",
  "coffee",
]);

/**
 * Parse the `Commands:` block of a `--help` dump into subcommand names.
 *
 * Two details in Commander's layout will wreck a naive parser:
 *
 *   1. **Wrapped descriptions are indented too.** A long description
 *      continues on the next line, indented to the description column:
 *
 *          demo       Toggle persistent demo mode (in-memory sample
 *                     data, no credentials)
 *
 *      Treating every indented line as an entry yields a command named
 *      `data,`. Real entries sit at exactly two spaces, so that's the
 *      discriminator.
 *   2. **Aliases share a line** — `recommendations|recs` — so split on
 *      `|` as well as whitespace and keep the canonical name.
 */
function parseSubcommands(help: string): string[] {
  const lines = help.split("\n");
  const start = lines.findIndex((l) => l.trim() === "Commands:");
  if (start === -1) return [];
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    // The block ends at the first blank line.
    if (line.trim() === "") break;
    // Exactly two spaces = an entry. More = a wrapped description.
    if (!/^ {2}\S/.test(line)) continue;
    const name = line.trim().split(/[\s|]/)[0];
    if (!name || name === "help") continue;
    if (!/^[a-z][a-z0-9-]*$/.test(name)) continue;
    names.push(name);
  }
  return names;
}

/**
 * Confirm a `--help` dump actually belongs to the path we probed.
 *
 * This matters because an unknown command doesn't just fail — it prints
 * the ROOT help, `Commands:` block and all. Without this check a single
 * bogus name expands into all ~26 top-level commands, each of which is
 * also bogus and expands again. The walk goes combinatorial (8,308 nodes
 * at depth 3) and dies on the hook timeout.
 *
 * Commander stamps the real path in the Usage line — `Usage: pax8
 * clients list [options]` — and the root fallback reads `Usage: pax8
 * [options] [command]`, so a prefix match separates them cleanly.
 */
function usageMatches(help: string, prefix: string[]): boolean {
  const line = help.split("\n").find((l) => l.startsWith("Usage:"));
  if (!line) return false;
  const expected = ["pax8", ...prefix].join(" ");
  return line.slice("Usage:".length).trim().startsWith(expected);
}

/**
 * Walk the command tree breadth-first, returning every leaf path.
 *
 * Depth is capped at 3 — `quotes line-items remove` is the deepest path
 * that exists today, and a deeper tree would be a design change worth
 * failing on.
 *
 * Concurrency is capped too. Each probe is a real `node` spawn costing
 * ~0.45s, and the tree has ~100 nodes; fanning them out all at once
 * makes the machine thrash and turns a 6-second walk into a multi-minute
 * one (which is how this test first got written — and timed out).
 */
const PROBE_CONCURRENCY = 8;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const i = cursor++;
        results[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

async function discoverCommandPaths(): Promise<string[]> {
  const leaves: string[] = [];
  let frontier: string[][] = [[]];

  for (let depth = 0; depth <= 3 && frontier.length > 0; depth++) {
    const probed = await mapWithConcurrency(
      frontier,
      PROBE_CONCURRENCY,
      async (prefix) => {
        const help = (await runCli([...prefix, "--help"], { PAX8_DEMO: "1" }))
          .stdout;
        // A path whose help doesn't identify as that path isn't a real
        // command — don't walk into it, and don't record it as a leaf.
        if (!usageMatches(help, prefix)) {
          return { prefix, subs: [] as string[], real: false };
        }
        return { prefix, subs: parseSubcommands(help), real: true };
      },
    );
    const next: string[][] = [];
    for (const { prefix, subs, real } of probed) {
      if (!real) continue;
      if (subs.length === 0) {
        // A node with no Commands: block is a leaf. The root having no
        // subcommands would mean the walk found nothing at all, which
        // the "plausible command tree" assertion below catches.
        if (prefix.length) leaves.push(prefix.join(" "));
        continue;
      }
      for (const sub of subs) next.push([...prefix, sub]);
    }
    frontier = next;
  }

  // Anything still in the frontier at the depth cap is deeper than the
  // tree is supposed to go — record it so the inventory assertion fails
  // loudly rather than silently dropping a whole subtree.
  for (const prefix of frontier) leaves.push(prefix.join(" "));

  return leaves;
}

let COMMAND_PATHS: string[] = [];

// ── Parsed-payload shapes ────────────────────────────────────────────────────
//
// These describe only the fields the assertions below touch. `JsonRecord`
// keeps index access type-safe without reaching for `any`, which the repo
// lint bans.

type JsonRecord = Record<string, unknown>;

interface EmittedAction {
  command?: unknown;
  args?: unknown;
  description?: unknown;
}

interface TodayItem {
  action?: EmittedAction;
}

interface ActionPayload extends JsonRecord {
  nextActions?: EmittedAction[];
  items?: TodayItem[];
}

interface RecommendationRow {
  title?: string;
  orderArgs?: string[] | null;
  suggestedProducts?: string[];
}

interface ProductRow {
  id: string;
  name: string;
}

interface MoneyLike {
  amount?: unknown;
  currency?: unknown;
}

function parse<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}


// ── List-envelope expectations ───────────────────────────────────────────────
//
// argv → the resource key the envelope must carry at top level. Keep
// this table in sync with the "The list envelope (#483)" section of
// skill.md; the test below asserts the doc names each key too.

const LIST_ENVELOPES: {
  args: string[];
  key: string;
  /**
   * Whether this command accepts `--with-actions`. It is NOT universal,
   * despite what the docs claimed before #704: `products list`,
   * `products search`, `quotes list`, `contacts list`, `usage list`, and
   * `invoices items` all reject the flag outright (exit 1,
   * ERROR_INVALID_INPUT). The envelope contract is universal; the
   * nextActions contract is not, and agents need to know which is which.
   */
  withActions: boolean;
}[] = [
  { args: ["clients", "list"], key: "companies", withActions: true },
  { args: ["subscriptions", "list"], key: "subscriptions", withActions: true },
  { args: ["invoices", "list"], key: "invoices", withActions: true },
  { args: ["orders", "list"], key: "orders", withActions: true },
  { args: ["webhooks", "list"], key: "webhooks", withActions: true },
  { args: ["webhooks", "logs"], key: "logs", withActions: true },
  { args: ["webhooks", "topics", "list"], key: "topics", withActions: true },
  {
    args: ["subscriptions", "renewals", "--within", "30d"],
    key: "renewals",
    withActions: true,
  },
  { args: ["products", "list"], key: "products", withActions: false },
  // `contacts list` is company-scoped — it refuses to run portfolio-wide,
  // so the probe has to name a company from the demo fixture.
  {
    args: ["contacts", "list", "--company", "Redwood Manufacturing"],
    key: "contacts",
    withActions: false,
  },
  { args: ["quotes", "list"], key: "quotes", withActions: false },
  { args: ["usage", "list"], key: "usage", withActions: false },
];

describe("skill distribution", () => {
  /**
   * The canonical skill lives at `packages/claude-skill/skill.md`, but the
   * file Claude Code actually reads inside this repo is
   * `.claude/skills/pax8/SKILL.md`. Those had diverged for six months —
   * `.gitignore` excluded all of `.claude/`, so the loaded copy was a
   * pre-launch stub that no PR could see, review, or update. Every
   * correction landed in the canonical file and reached nobody.
   *
   * A symlink would be the obvious fix, but Windows checkouts turn symlinks
   * into plain files containing a path, which would break skill loading
   * there silently. So both files are tracked and this asserts they match:
   * a stale copy is now a red build instead of a six-month drift.
   */
  it("the installed skill matches the canonical one byte-for-byte", () => {
    const canonical = readFileSync(join(REPO_ROOT, SKILL_PATH), "utf-8");
    const installed = readFileSync(join(REPO_ROOT, INSTALLED_SKILL_PATH), "utf-8");
    expect(
      installed === canonical,
      `${INSTALLED_SKILL_PATH} has drifted from ${SKILL_PATH}.\n` +
        `Run:  cp ${SKILL_PATH} ${INSTALLED_SKILL_PATH}\n\n` +
        `The .claude copy is what Claude Code loads in this repo — editing only ` +
        `the canonical file means your change reaches no agent working here.`,
    ).toBe(true);
  });

  it("the installed skill is tracked by git", () => {
    // `.gitignore` excludes `.claude/*` and re-includes only `skills/`.
    // If that negation is ever dropped, the file silently leaves review again.
    const tracked = execFileSync("git", ["ls-files", INSTALLED_SKILL_PATH], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
    }).trim();
    expect(
      tracked,
      `${INSTALLED_SKILL_PATH} is not tracked by git — check the ` +
        `"!.claude/skills/" negation in .gitignore. Untracked is how this ` +
        `file went stale for six months.`,
    ).toBe(INSTALLED_SKILL_PATH);
  });
});

describe("agent-contract surface pinning (#704)", () => {
  beforeAll(async () => {
    COMMAND_PATHS = await discoverCommandPaths();
  }, 180_000);

  describe("command inventory — every command is documented in skill.md", () => {
    it("discovers a plausible command tree", () => {
      // Guard against the walker silently returning [] and turning the
      // inventory assertion below into a no-op that always passes.
      expect(COMMAND_PATHS.length).toBeGreaterThan(50);
      expect(COMMAND_PATHS).toContain("clients list");
      expect(COMMAND_PATHS).toContain("quotes line-items remove");
    });

    it("every command path appears verbatim in skill.md", () => {
      const skill = readSkill();
      const missing = COMMAND_PATHS.filter(
        (p) => !INVENTORY_EXEMPT.has(p) && !skill.includes(p),
      );
      expect(
        missing,
        `These commands exist but are undocumented in ${SKILL_PATH}:\n` +
          missing.map((m) => `  pax8 ${m}`).join("\n") +
          `\n\nAdd each one to the skill — and if it mutates anything ` +
          `(Pax8 state OR local machine state), add it to the WRITE half ` +
          `of the safety contract, not just the command list. An agent ` +
          `that can't find a command in the contract has no way to know ` +
          `it needs confirmation.`,
      ).toEqual([]);
    });
  });

  describe("list envelope keys (#483)", () => {
    it.each(LIST_ENVELOPES)(
      "`pax8 $args.0 $args.1 --json` emits a top-level `$key` array",
      async ({ args, key }) => {
        const result = await runCliExpectSuccess([...args, "--json"], {
          PAX8_DEMO: "1",
        });
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;
        expect(
          Object.keys(payload),
          `Envelope for \`pax8 ${args.join(" ")}\` is missing its "${key}" key. ` +
            `Since #483 list commands wrap as { <resource>, page }. If the key ` +
            `was renamed, update both this table and the "The list envelope" ` +
            `section of ${SKILL_PATH}.`,
        ).toContain(key);
        expect(Array.isArray(payload[key])).toBe(true);
      },
    );

    it("no list command emits a top-level `items` key", async () => {
      // `--with-actions` was documented as producing `{ items, nextActions }`
      // in both skill.md and AGENTS.md. It never did. `invoices items` is
      // the sole legitimate `items` key — it's the resource name there —
      // so it's excluded rather than exempted by special-casing at runtime.
      const offenders: string[] = [];
      for (const { args, withActions } of LIST_ENVELOPES) {
        const result = await runCliExpectSuccess(
          [...args, "--json", ...(withActions ? ["--with-actions"] : [])],
          { PAX8_DEMO: "1" },
        );
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;
        if ("items" in payload) offenders.push(args.join(" "));
      }
      expect(
        offenders,
        `These commands emit a top-level "items" key: ${offenders.join(", ")}. ` +
          `Agents are documented to read the resource-named key; introducing ` +
          `"items" would make both conventions live at once.`,
      ).toEqual([]);
    });

    it("`--with-actions` adds nextActions without restructuring the envelope", async () => {
      const plain = JSON.parse(
        (await runCliExpectSuccess(["clients", "list", "--json"], { PAX8_DEMO: "1" }))
          .stdout,
      ) as Record<string, unknown>;
      const withActions = JSON.parse(
        (
          await runCliExpectSuccess(
            ["clients", "list", "--json", "--with-actions"],
            { PAX8_DEMO: "1" },
          )
        ).stdout,
      ) as Record<string, unknown>;

      // Additive only: every plain key survives, and exactly nextActions is new.
      for (const k of Object.keys(plain)) {
        expect(Object.keys(withActions)).toContain(k);
      }
      const added = Object.keys(withActions).filter((k) => !(k in plain));
      expect(added).toEqual(["nextActions"]);
    });

    it("`--with-actions` support matches the documented matrix", async () => {
      // Pins both directions. If a command gains the flag, the docs
      // should start advertising it; if one loses it, an agent passing
      // the flag would hard-fail with exit 1 rather than degrade.
      const wrong: string[] = [];
      for (const { args, withActions } of LIST_ENVELOPES) {
        const result = await runCli([...args, "--json", "--with-actions"], {
          PAX8_DEMO: "1",
        });
        const accepted = result.exitCode === 0;
        if (accepted !== withActions) {
          wrong.push(
            `pax8 ${args.join(" ")} — table says ${withActions ? "supported" : "rejected"}, CLI ${accepted ? "accepted" : "rejected"} it`,
          );
        }
      }
      expect(
        wrong,
        `\`--with-actions\` support drifted:\n  ${wrong.join("\n  ")}\n\n` +
          `Update both this table and the Output-flags section of ${SKILL_PATH} ` +
          `(and AGENTS.md). Do not restore the blanket claim that every list ` +
          `command accepts the flag — it never has.`,
      ).toEqual([]);
    });

    it("pins the commands that deliberately break the envelope rule", async () => {
      // Two exceptions exist and both are documented. This test is here so a
      // third can't appear silently — an agent that assumes `{ <resource>, page }`
      // and gets a bare array reads `.page` as null and concludes the data is
      // missing. `quotes line-items list` was found only by running it.
      const lineItems = parse<unknown>(
        (await runCliExpectSuccess(
          ["quotes", "line-items", "list", "quote-bright-001", "--json"],
          { PAX8_DEMO: "1" },
        )).stdout,
      );
      expect(
        Array.isArray(lineItems),
        "`quotes line-items list` used to return a bare array. If it now returns an " +
          `envelope that is an improvement — move it into LIST_ENVELOPES and drop the ` +
          `exception from ${SKILL_PATH}.`,
      ).toBe(true);

      const recs = parse<JsonRecord>(
        (await runCliExpectSuccess(["recommendations", "list", "--json"], {
          PAX8_DEMO: "1",
        })).stdout,
      );
      expect(Object.keys(recs).sort()).toEqual([
        "recommendations",
        "totalAvailable",
      ]);

      const skill = readSkill();
      for (const phrase of ["quotes line-items list", "bare JSON array"]) {
        expect(
          skill.includes(phrase),
          `${SKILL_PATH} must keep documenting the bare-array exception.`,
        ).toBe(true);
      }
    });

    it("documents the `_`-prefixed display artifacts agents must ignore", async () => {
      // `clients list` mixes table-rendering strings into the JSON payload.
      // They shadow real fields (`_coverage: "3/7"` vs `coverage: "3/7"`), so
      // an agent can easily read the formatted one and then try to do math on it.
      const payload = parse<{ companies: JsonRecord[] }>(
        (await runCliExpectSuccess(["clients", "list", "--coverage", "--json"], {
          PAX8_DEMO: "1",
        })).stdout,
      );
      const underscored = Object.keys(payload.companies[0]).filter((k) =>
        k.startsWith("_"),
      );
      expect(underscored.length).toBeGreaterThan(0);
      expect(
        readSkill().includes("Ignore `_`-prefixed keys"),
        `clients list emits ${JSON.stringify(underscored)} into its JSON payload. ` +
          `${SKILL_PATH} must tell agents to ignore them — or the CLI should stop ` +
          `emitting them, in which case delete this test and the skill paragraph.`,
      ).toBe(true);
    });

    it("skill.md documents each envelope key it tells agents to read", () => {
      const skill = readSkill();
      for (const { key } of LIST_ENVELOPES) {
        expect(
          skill.includes(`\`${key}\``),
          `Envelope key "${key}" is emitted by the CLI but never named as ` +
            `inline code in ${SKILL_PATH}. Agents can't guess it.`,
        ).toBe(true);
      }
    });
  });

  describe("emitted actions (#708) — args presence and write classification", () => {
    /**
     * Every surface that emits actions, and whether its entries carry
     * `args`. This is NOT the contract we want — #708 tracks backfilling
     * `args` everywhere — it is the contract that ships today, pinned so
     * the skill's per-surface table can't silently go stale in either
     * direction. When #708 lands, flip the flags here and in skill.md
     * together.
     */
    const ACTION_SURFACES: {
      args: string[];
      path: string;
      hasArgs: boolean;
    }[] = [
      { args: ["today", "--json"], path: "nextActions", hasArgs: true },
      { args: ["today", "--json"], path: "items[].action", hasArgs: true },
      {
        args: ["clients", "list", "--json", "--with-actions"],
        path: "nextActions",
        hasArgs: true,
      },
      { args: ["dashboard", "--json"], path: "nextActions", hasArgs: false },
      {
        args: ["invoices", "audit", "--json"],
        path: "nextActions",
        hasArgs: false,
      },
      {
        args: ["subscriptions", "renewals", "--json", "--with-actions"],
        path: "nextActions",
        hasArgs: false,
      },
    ];

    function collectActions(
      payload: ActionPayload,
      path: string,
    ): EmittedAction[] {
      if (path === "nextActions") return payload.nextActions ?? [];
      return (payload.items ?? [])
        .map((i) => i.action)
        .filter((a): a is EmittedAction => Boolean(a));
    }

    it.each(ACTION_SURFACES)(
      "`pax8 $args.0` $path — args present: $hasArgs",
      async ({ args, path, hasArgs }) => {
        const result = await runCliExpectSuccess(args, { PAX8_DEMO: "1" });
        const actions = collectActions(parse<ActionPayload>(result.stdout), path);
        expect(actions.length).toBeGreaterThan(0);
        for (const a of actions) {
          expect(typeof a.command).toBe("string");
          expect(
            Array.isArray(a.args),
            `\`pax8 ${args.join(" ")}\` ${path}: expected args ${hasArgs ? "present" : "absent"} ` +
              `but got the opposite. If #708 landed, flip hasArgs here AND update the ` +
              `"Which emitted actions carry args" table in ${SKILL_PATH} — an agent that ` +
              `trusts a stale table either crashes or falls back to tokenizing \`command\`.`,
          ).toBe(hasArgs);
          if (hasArgs) expect(a.args[0]).toBe("pax8");
        }
      },
    );

    it("skill.md warns that read commands emit write commands", () => {
      // The specific hazard: `invoices audit` and `today` are reads whose
      // payloads contain `invoices dispute` / `orders create` /
      // `recommendations act`. An agent told only "spawn args.slice(1)"
      // runs them. Assert the warning survives future edits.
      const skill = readSkill();
      expect(skill).toContain("Suggested actions are not permission to act");
      for (const phrase of [
        "Read commands emit write commands",
        "resolve its command path against the read/write lists",
      ]) {
        expect(
          skill.includes(phrase),
          `${SKILL_PATH} lost the phrase "${phrase}". The read/write check on emitted ` +
            `actions is load-bearing — without it the argv contract only prevents shell ` +
            `injection, not unintended writes.`,
        ).toBe(true);
      }
    });

    it("read commands really do emit write commands (the hazard is real)", async () => {
      // If this ever fails it is GOOD news — it means the CLI stopped
      // handing writes out of read payloads. Relax the skill's warning
      // only when this test says the hazard is gone.
      const WRITE_PREFIXES = [
        "pax8 invoices dispute",
        "pax8 orders create",
        "pax8 recommendations act",
      ];
      const audit = parse<ActionPayload>(
        (await runCliExpectSuccess(["invoices", "audit", "--json"], {
          PAX8_DEMO: "1",
        })).stdout,
      );
      const emitted = (audit.nextActions ?? []).map((a) => String(a.command));
      expect(
        emitted.some((c) => WRITE_PREFIXES.some((w) => c.startsWith(w))),
        "invoices audit no longer emits write commands — if that is intentional, " +
          `the corresponding warning in ${SKILL_PATH} can be softened.`,
      ).toBe(true);
    });
  });

  describe("recommendations orderArgs (#707)", () => {
    it("keeps telling agents to verify the SKU before ordering", () => {
      // #707 is fixed, but the guard is defence-in-depth against the next
      // productId/productName disagreement, and it costs one read.
      expect(
        readSkill().includes("Verify the SKU before every recommendation-derived order"),
        `${SKILL_PATH} dropped the pre-order SKU check. The specific #707 fixture bug ` +
          `is fixed, but orderCommand still renders a product ID rather than a name, ` +
          `so a wrong SKU remains invisible in a human preview.`,
      ).toBe(true);
    });

    it(
      "orderArgs --product resolves to suggestedProducts[0] (#707)",
      async () => {
        // Was `it.fails` while #707 was open. The fixture had a
        // subscription whose productId pointed at M365 E3 while its
        // productName said onboarding, so the engine faithfully emitted an
        // orderArgs naming the wrong SKU. Now a real assertion: any future
        // row whose productId and productName disagree fails here rather
        // than surfacing as an agent placing the wrong order.
        const recs = parse<{ recommendations: RecommendationRow[] }>(
          (await runCliExpectSuccess(
            ["recommendations", "list", "--json", "--top", "0"],
            { PAX8_DEMO: "1" },
          )).stdout,
        ).recommendations;
        const products = parse<{ products: ProductRow[] }>(
          (await runCliExpectSuccess(["products", "list", "--json"], {
            PAX8_DEMO: "1",
          })).stdout,
        ).products;
        const byId = new Map(products.map((p) => [p.id, p.name]));

        for (const rec of recs) {
          if (!rec.orderArgs) continue;
          const i = rec.orderArgs.indexOf("--product");
          const resolved = byId.get(rec.orderArgs[i + 1]);
          expect(
            resolved,
            `${rec.title}: orderArgs --product ${rec.orderArgs[i + 1]} resolves to ` +
              `"${resolved}", but suggestedProducts[0] is "${rec.suggestedProducts?.[0]}"`,
          ).toBe(rec.suggestedProducts?.[0]);
        }
      },
    );
  });

  describe("documented field paths exist at runtime", () => {
    it("dashboard emits monthlyCost/annualCost as { amount, currency }", async () => {
      const result = await runCliExpectSuccess(["dashboard", "--json"], {
        PAX8_DEMO: "1",
      });
      interface DashboardPayload extends JsonRecord {
        topCustomers: { monthlyCost?: MoneyLike }[];
      }
      const d = parse<DashboardPayload>(result.stdout);

      for (const field of ["monthlyCost", "annualCost"]) {
        const money = d[field] as MoneyLike | undefined;
        expect(money, `dashboard.${field} missing`).toBeDefined();
        expect(typeof money?.amount).toBe("number");
        expect(typeof money?.currency).toBe("string");
      }

      // The pre-#704 doc name. If it ever comes back, the docs and this
      // test should be changed together and deliberately.
      expect(d.pax8MonthlyCost).toBeUndefined();

      expect(Array.isArray(d.topCustomers)).toBe(true);
      expect(d.topCustomers.length).toBeGreaterThan(0);
      expect(typeof d.topCustomers[0]?.monthlyCost?.amount).toBe("number");

      // Other top-level keys the skill's "Portfolio Pax8 cost" recipe names.
      for (const k of [
        "totalCompanies",
        "activeSubscriptions",
        "activeTrials",
        "totalSeats",
        "renewalsNext30Days",
        "urgentRenewals",
        "highPriorityRecs",
        "potentialMonthlyUplift",
      ]) {
        expect(d, `dashboard.${k} is named in ${SKILL_PATH} but not emitted`)
          .toHaveProperty(k);
      }
    });

    it("today emits the summary keys the morning-brief recipe names", async () => {
      const result = await runCliExpectSuccess(["today", "--json"], {
        PAX8_DEMO: "1",
      });
      const t = parse<{ summary: JsonRecord } & JsonRecord>(result.stdout);
      for (const k of ["asOf", "items", "summary", "nextActions"]) {
        expect(t).toHaveProperty(k);
      }
      for (const k of [
        "totalItems",
        "urgentRenewals",
        "auditDiscrepancies",
        "growthOpportunities",
        "expiringTrials",
        "upcomingRenewals",
        "monthlyImpact",
        "dollarsOnTable",
        "truncated",
      ]) {
        expect(t.summary, `today summary.${k} is documented but not emitted`)
          .toHaveProperty(k);
      }
    });

    it("recommendations list keeps its { recommendations, totalAvailable } envelope (#521)", async () => {
      const result = await runCliExpectSuccess(
        ["recommendations", "list", "--json"],
        { PAX8_DEMO: "1" },
      );
      const r = parse<{ recommendations: RecommendationRow[] } & JsonRecord>(result.stdout);
      expect(Object.keys(r).sort()).toEqual(["recommendations", "totalAvailable"]);
      // orderArgs is the safe-execution half of the #462 pair; the skill
      // tells agents to spawn orderArgs.slice(1). Both must be present.
      expect(Array.isArray(r.recommendations[0].orderArgs)).toBe(true);
      expect(r.recommendations[0].orderArgs[0]).toBe("pax8");
      expect(typeof r.recommendations[0].orderCommand).toBe("string");
    });

    it("invoices audit rows carry the field names the recipe documents", async () => {
      // This assertion exists because the first version of the audit recipe
      // invented `id`, `expected`, and `actual` — none of which are emitted.
      // An agent building `--discrepancy ${row.id}` would have produced
      // `--discrepancy undefined` and shown the user a preview naming a
      // discrepancy that doesn't exist, defeating write-protocol step 1.
      const audit = parse<{ discrepancies: JsonRecord[] } & JsonRecord>(
        (await runCliExpectSuccess(["invoices", "audit", "--json"], {
          PAX8_DEMO: "1",
        })).stdout,
      );
      expect(audit.discrepancies.length).toBeGreaterThan(0);
      const row = audit.discrepancies[0];
      for (const k of [
        "discrepancyId",
        "type",
        "companyId",
        "companyName",
        "productName",
        "invoicedQuantity",
        "activeQuantity",
        "delta",
        "dollarImpact",
      ]) {
        expect(
          row,
          `audit discrepancy row is missing "${k}", which ${SKILL_PATH} tells agents to read`,
        ).toHaveProperty(k);
      }
      // The dispute argument is `discrepancyId`; a bare `id` has never existed.
      expect(row).not.toHaveProperty("id");

      for (const k of ["totalOvercharge", "totalUndercharge", "netImpact", "itemsAudited"]) {
        expect(audit, `audit envelope is missing "${k}"`).toHaveProperty(k);
      }
    });

    it("subscriptions renewals carries no aggregate the docs could point at", async () => {
      // The renewal-triage recipe used to say "lead with totalMrrRenewing".
      // That field is real on @pax8/core's RenewalReport but absent from the
      // CLI envelope, so the recipe now tells agents to sum mrrRenewing
      // themselves. If an aggregate is ever added to the CLI output, this
      // fails — go update the recipe to use it.
      const result = await runCliExpectSuccess(
        ["subscriptions", "renewals", "--json", "--within", "30d"],
        { PAX8_DEMO: "1" },
      );
      interface RenewalsPayload extends JsonRecord {
        renewals: { mrrRenewing?: unknown }[];
      }
      const payload = parse<RenewalsPayload>(result.stdout);
      expect(payload.totalMrrRenewing).toBeUndefined();
      expect(payload.renewals.length).toBeGreaterThan(0);
      // The per-row field the recipe tells agents to sum.
      expect(typeof payload.renewals[0]?.mrrRenewing).toBe("number");
    });
  });
});
