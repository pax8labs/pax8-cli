// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Agent-contract enum pinning (#636).
 *
 * TypeScript narrows string-union types only inside this repo's compile
 * pass. Downstream agents — the Claude skill, the published MCP host,
 * any partner-side script grepping `--json` output — consume the
 * RUNTIME string values. A rename here (e.g. `growth-high` →
 * `growth-priority`) would type-check locally and silently break every
 * downstream agent that switches on the old literal.
 *
 * Each enum below has two assertions:
 *
 *   1. **Runtime emission.** Drive the relevant CLI command in
 *      `PAX8_DEMO=1` and assert every emitted value falls inside the
 *      documented allowed set. Subset, not equality — the demo fixtures
 *      don't necessarily exercise every branch (e.g. `Add-on` /
 *      `Upgrade` opportunity types aren't produced by the current
 *      recommendations engine), and that's expected.
 *
 *   2. **Doc drift.** For enums documented in the three agent-facing
 *      doc files (`AGENTS.md`, `CLAUDE.md`, `packages/claude-skill/skill.md`),
 *      assert each allowed value appears verbatim in at least one of
 *      those docs. If someone renames a value in code but forgets the
 *      docs, this fails.
 *
 *      Enums not documented in those agent-facing files (e.g.
 *      Recommendation.type / opportunityType — currently documented in
 *      the `recommendations list --help` text, the README, and the
 *      CHANGELOG, but not in AGENTS/CLAUDE/skill) skip the doc-grep
 *      check. Flagging the gap is a separate decision for the
 *      maintainer; pinning the runtime contract still has value.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runCliExpectSuccess } from "./test-utils.js";

// Repo root: this file is at packages/cli/src/__tests__/, so up four.
const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

const AGENT_DOC_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "packages/claude-skill/skill.md",
] as const;

// ── Allowed sets — single source of truth for both runtime + doc tests ───────
//
// These mirror the code-side unions exactly. Keep them sorted and
// commented so any future rename PR has one place to update.

/** `TodayItemKind` from packages/cli/src/commands/today.ts. */
const TODAY_ITEM_KINDS = [
  "renewal-urgent",
  "audit-overcharge",
  "audit-undercharge",
  "growth-high",
  "trial-expiring",
  "renewal-upcoming",
] as const;

/** `Recommendation.priority` from packages/core/src/services/recommendations.ts. */
const RECOMMENDATION_PRIORITIES = ["high", "medium", "low"] as const;

/** `Recommendation.type` from packages/core/src/services/recommendations.ts. */
const RECOMMENDATION_TYPES = ["seat_gap", "cross_sell"] as const;

/** `OpportunityType` from packages/core/src/services/recommendations.ts. */
const OPPORTUNITY_TYPES = [
  "Upsell",
  "Cross-sell",
  "Add-on",
  "Upgrade",
  "Net-new",
] as const;

/** `AuditDiscrepancy.type` from packages/core/src/services/invoice-auditor.ts. */
const AUDIT_DISCREPANCY_TYPES = [
  "overcharge",
  "undercharge",
  "missing",
  "unexpected",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function readDoc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

/**
 * Read each doc file and concatenate so a single search hits all of
 * them. Returned untouched (preserves markdown, code fences, etc.).
 */
function loadAgentDocs(): { name: string; body: string }[] {
  return AGENT_DOC_FILES.map((rel) => ({ name: rel, body: readDoc(rel) }));
}

/**
 * Assert each `value` appears as a quoted or backtick-bounded literal
 * in at least one of `docs`. Quotation matters: a bare prose mention
 * like "overcharges and undercharges" wouldn't catch a code rename
 * to `over_charge`. We accept any of:
 *   - "value"   (JSON-style double quote)
 *   - 'value'   (single quote)
 *   - `value`   (backtick — markdown inline code)
 *
 * Each missing value emits an explicit message so the failure points
 * the author at exactly which doc needs updating.
 */
function assertDocumented(
  values: readonly string[],
  docs: { name: string; body: string }[],
  label: string,
): void {
  for (const v of values) {
    const patterns = [`"${v}"`, `'${v}'`, `\`${v}\``];
    const found = docs.some((d) =>
      patterns.some((p) => d.body.includes(p)),
    );
    expect(
      found,
      `${label}: value "${v}" not documented (as a quoted literal) in any of ${AGENT_DOC_FILES.join(", ")}. Update the agent-facing docs to keep them in sync with the code's union.`,
    ).toBe(true);
  }
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("agent-contract enum pinning (#636)", () => {
  describe("TodayItemKind — `pax8 today --json`", () => {
    it("every emitted items[].kind is in the allowed set", async () => {
      const result = await runCliExpectSuccess(["today", "--json"]);
      const payload = JSON.parse(result.stdout) as {
        items: { kind: string }[];
      };
      expect(payload.items.length).toBeGreaterThan(0);
      const allowed = new Set<string>(TODAY_ITEM_KINDS);
      for (const item of payload.items) {
        expect(
          allowed.has(item.kind),
          `today items[].kind="${item.kind}" not in allowed set ${JSON.stringify([...allowed])}`,
        ).toBe(true);
      }
    });

    it("every allowed value appears as a quoted literal in agent docs", () => {
      assertDocumented(TODAY_ITEM_KINDS, loadAgentDocs(), "TodayItemKind");
    });
  });

  describe("Recommendation.priority — `pax8 recommendations list --json`", () => {
    it("every emitted recommendations[].priority is in the allowed set", async () => {
      // `--top 0` widens the cap to surface every priority bucket the
      // engine can produce. The small fixture doesn't reach "low" by
      // default, so without this the check would silently never see
      // the low branch.
      const result = await runCliExpectSuccess([
        "recommendations",
        "list",
        "--json",
        "--top",
        "0",
      ]);
      const payload = JSON.parse(result.stdout) as {
        recommendations: { priority: string }[];
      };
      expect(payload.recommendations.length).toBeGreaterThan(0);
      const allowed = new Set<string>(RECOMMENDATION_PRIORITIES);
      for (const rec of payload.recommendations) {
        expect(
          allowed.has(rec.priority),
          `recommendation priority="${rec.priority}" not in allowed set ${JSON.stringify([...allowed])}`,
        ).toBe(true);
      }
    });

    it("every allowed value appears as a quoted literal in agent docs", () => {
      assertDocumented(
        RECOMMENDATION_PRIORITIES,
        loadAgentDocs(),
        "Recommendation.priority",
      );
    });
  });

  describe("Recommendation.type — `pax8 recommendations list --json`", () => {
    it("every emitted recommendations[].type is in the allowed set", async () => {
      const result = await runCliExpectSuccess([
        "recommendations",
        "list",
        "--json",
        "--top",
        "0",
      ]);
      const payload = JSON.parse(result.stdout) as {
        recommendations: { type: string }[];
      };
      expect(payload.recommendations.length).toBeGreaterThan(0);
      const allowed = new Set<string>(RECOMMENDATION_TYPES);
      for (const rec of payload.recommendations) {
        expect(
          allowed.has(rec.type),
          `recommendation type="${rec.type}" not in allowed set ${JSON.stringify([...allowed])}`,
        ).toBe(true);
      }
    });

    // No doc-grep test: `seat_gap` / `cross_sell` are documented in the
    // `recommendations list --help` text, README, and CHANGELOG, but
    // not in any of AGENTS.md / CLAUDE.md / skill.md. The runtime
    // check above still pins the contract.
  });

  describe("Recommendation.opportunityType — `pax8 recommendations list --json`", () => {
    it("every emitted recommendations[].opportunityType is in the allowed set", async () => {
      // Note: `Add-on` and `Upgrade` aren't currently emitted by the
      // engine — they're aspirational categories on the additive
      // opportunityType axis. This is a subset check, not equality.
      const result = await runCliExpectSuccess([
        "recommendations",
        "list",
        "--json",
        "--top",
        "0",
      ]);
      const payload = JSON.parse(result.stdout) as {
        recommendations: { opportunityType: string }[];
      };
      expect(payload.recommendations.length).toBeGreaterThan(0);
      const allowed = new Set<string>(OPPORTUNITY_TYPES);
      for (const rec of payload.recommendations) {
        expect(
          allowed.has(rec.opportunityType),
          `recommendation opportunityType="${rec.opportunityType}" not in allowed set ${JSON.stringify([...allowed])}`,
        ).toBe(true);
      }
    });

    // No doc-grep test: the 5-value OpportunityType taxonomy is
    // documented in `recommendations list --help` and the CHANGELOG
    // (and the README's STAX-divergence table), but not in any of
    // AGENTS.md / CLAUDE.md / skill.md.
  });

  describe("AuditDiscrepancy.type — `pax8 invoices audit --json`", () => {
    it("every emitted discrepancies[].type is in the allowed set", async () => {
      const result = await runCliExpectSuccess([
        "invoices",
        "audit",
        "--json",
      ]);
      const payload = JSON.parse(result.stdout) as {
        discrepancies: { type: string }[];
      };
      expect(payload.discrepancies.length).toBeGreaterThan(0);
      const allowed = new Set<string>(AUDIT_DISCREPANCY_TYPES);
      for (const disc of payload.discrepancies) {
        expect(
          allowed.has(disc.type),
          `audit discrepancy type="${disc.type}" not in allowed set ${JSON.stringify([...allowed])}`,
        ).toBe(true);
      }
    });

    // No doc-grep test: AGENTS.md / skill.md mention "overcharge" /
    // "undercharge" in prose ("Group discrepancies by category
    // (overcharge, undercharge, orphan line item)"), but not as quoted
    // enum literals — and "missing" / "unexpected" aren't documented
    // in those files at all. Adding the missing literals to the agent
    // docs is the maintainer's call; the runtime check above still
    // pins the wire contract.
  });
});
