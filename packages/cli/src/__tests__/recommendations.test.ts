// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import YAML from "yaml";
import { runCli, runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 recommendations", () => {
  describe("recommendations list", () => {
    // #521: JSON output is now ALWAYS a wrapped envelope
    // `{ recommendations: [...], totalAvailable: number }`, even without
    // `--with-actions`. The previous flat-array shape was a footgun on
    // large portfolios — capping by default but emitting a bare array
    // silently hid 298 of 308 recs (same anti-pattern #483 fixed
    // elsewhere). Pre-publish, so OK to break.
    it("returns a wrapped envelope { recommendations, totalAvailable } in JSON by default", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("recommendations");
      expect(data).toHaveProperty("totalAvailable");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(typeof data.totalAvailable).toBe("number");
      expect(data.recommendations.length).toBeGreaterThan(0);
      // Default cap = 10
      expect(data.recommendations.length).toBeLessThanOrEqual(10);
      // totalAvailable is the pre-cap count and must be >= what was returned.
      expect(data.totalAvailable).toBeGreaterThanOrEqual(data.recommendations.length);
      expect(data.recommendations[0]).toHaveProperty("companyId");
      expect(data.recommendations[0]).toHaveProperty("companyName");
      expect(data.recommendations[0]).toHaveProperty("type");
      expect(data.recommendations[0]).toHaveProperty("priority");
    });

    it("--top <n> caps recommendations to N", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--json", "--top", "5",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(data.recommendations.length).toBeLessThanOrEqual(5);
      expect(data.totalAvailable).toBeGreaterThanOrEqual(data.recommendations.length);
    });

    // `--top 0` is the agent escape hatch — opt out of the cap entirely
    // and stream every rec the engine produced. Cassie's spec is clear
    // that this is the documented way to recover the pre-#521 unbounded
    // shape for downstream tooling that wants it.
    it("--top 0 returns all recommendations (unlimited)", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data.recommendations)).toBe(true);
      // When uncapped, totalAvailable === recommendations.length (no rows hidden).
      expect(data.totalAvailable).toBe(data.recommendations.length);
    });

    it("sorts by estimatedMrrUplift DESC with nulls last; priority breaks ties", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout) as {
        recommendations: Array<{
          estimatedMrrUplift: number | null;
          priority: "high" | "medium" | "low";
        }>;
      };
      const recs = data.recommendations;
      expect(recs.length).toBeGreaterThan(1);

      // No non-null uplift appears AFTER a null uplift (nulls-last
      // invariant). Once we cross into the null run, every subsequent
      // entry must also be null.
      let sawNull = false;
      for (const rec of recs) {
        if (rec.estimatedMrrUplift == null) {
          sawNull = true;
        } else {
          expect(sawNull).toBe(false);
        }
      }

      // First item is either the max non-null uplift OR (if every rec
      // has null uplift) is null.
      const nonNull = recs.filter((r) => r.estimatedMrrUplift != null);
      if (nonNull.length > 0) {
        const maxUplift = Math.max(...nonNull.map((r) => r.estimatedMrrUplift as number));
        expect(recs[0].estimatedMrrUplift).toBe(maxUplift);
      }

      // Within a same-uplift run, priority order is high > medium > low.
      // Walk adjacent pairs with identical non-null uplifts and assert the
      // priority rank is non-decreasing (lower index → better priority).
      const rank = { high: 0, medium: 1, low: 2 } as const;
      for (let i = 1; i < recs.length; i++) {
        const a = recs[i - 1];
        const b = recs[i];
        if (a.estimatedMrrUplift != null && a.estimatedMrrUplift === b.estimatedMrrUplift) {
          expect(rank[a.priority]).toBeLessThanOrEqual(rank[b.priority]);
        }
      }
    });

    it("--with-actions extends the envelope with nextActions + unmatchedProducts (and totalAvailable)", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--with-actions"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("recommendations");
      expect(data).toHaveProperty("totalAvailable");
      expect(data).toHaveProperty("nextActions");
      expect(data).toHaveProperty("unmatchedProducts");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(typeof data.totalAvailable).toBe("number");
      expect(Array.isArray(data.nextActions)).toBe(true);
      // Default cap still applies under --with-actions.
      expect(data.recommendations.length).toBeLessThanOrEqual(10);
      expect(data.nextActions.length).toBeLessThanOrEqual(5);
      if (data.nextActions.length > 0) {
        expect(data.nextActions[0]).toHaveProperty("command");
        expect(data.nextActions[0]).toHaveProperty("description");
      }
    });

    it("filters by exact company name", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright Minds Academy", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by partial company name (contains match)", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.companyName.toLowerCase()).toContain("bright");
      }
    });

    it("rejoins excess args into company name for unquoted multi-word names", async () => {
      // Simulates: --company Bright Minds Academy (no quotes)
      // Commander captures "Bright", "Minds" and "Academy" become excess args
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "Minds", "Academy", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by priority", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--priority", "high", "--json", "--top", "0",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations.length).toBeGreaterThan(0);
      for (const rec of data.recommendations) {
        expect(rec.priority).toBe("high");
      }
    });

    it("returns empty result for non-existent company", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "NonExistentCorp99999", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.recommendations).toEqual([]);
      expect(data.totalAvailable).toBe(0);
    });

    it("JSON output includes both available and unavailable recs for downstream filtering", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--top", "0"]);
      const parsed = JSON.parse(result.stdout);
      const allRecs = parsed.recommendations;

      // Some recs should have productAvailable: true, some false
      const available = allRecs.filter((r: { productAvailable: boolean }) => r.productAvailable);
      const unavailable = allRecs.filter((r: { productAvailable: boolean }) => !r.productAvailable);

      // The total should be the sum of available + unavailable
      expect(available.length + unavailable.length).toBe(allRecs.length);

      // Verify every rec has the productAvailable field
      for (const rec of allRecs) {
        expect(rec).toHaveProperty("productAvailable");
        expect(typeof rec.productAvailable).toBe("boolean");
      }
    });

    it("--include-all shows unavailable recs in JSON output", async () => {
      const withAll = await runCliExpectSuccess(["recommendations", "list", "--include-all", "--json", "--top", "0"]);
      const withoutAll = await runCliExpectSuccess(["recommendations", "list", "--json", "--top", "0"]);

      const allRecs = JSON.parse(withAll.stdout).recommendations;
      const defaultRecs = JSON.parse(withoutAll.stdout).recommendations;

      // Both should return the same set since JSON output is pre-filter
      // (JSON returns all recs; filtering only affects table mode)
      expect(allRecs.length).toBe(defaultRecs.length);
    });

    // #521 footer hint: when the cap fires, table mode must tell the
    // partner that there's more behind the curtain and how to widen it.
    // Forcing table mode via PAX8_OUTPUT_FORMAT because a non-TTY stdout
    // (the test subprocess) otherwise auto-falls back to JSON.
    it("table mode shows 'Showing top N of M' footer when --top caps the list", async () => {
      const result = await runCliExpectSuccess(
        ["recommendations", "list", "--top", "2"],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      // The footer is on stderr (hints/banners are never on stdout).
      expect(result.stderr).toMatch(/Showing top \d+ of \d+/);
      expect(result.stderr).toMatch(/--top 0/);
    });

    // Issue #195: human render leaked product UUIDs in a "Quick actions"
    // block AND re-printed every rec a second time as an `orders create
    // --product <uuid>` snippet (in addition to the table and the
    // promptNextSteps hint). The fix removes the Quick actions block; the
    // table + the one-line drill-in hint stay.
    //
    // Forcing table mode under a subprocess: stdout in `execFile` isn't a
    // TTY, so without `PAX8_OUTPUT_FORMAT=table` the CLI auto-falls back to
    // JSON for machine consumption and the human-render code path is never
    // exercised.
    it("does not leak product IDs into human (table) output", async () => {
      const result = await runCliExpectSuccess(
        ["recommendations", "list"],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      const combined = result.stdout + result.stderr;
      // The demo mock uses `prod-*` IDs for products; a real Pax8 deploy
      // uses RFC-4122 UUIDs. Neither shape should appear in human output.
      expect(combined).not.toMatch(/--product\s+prod-/);
      expect(combined).not.toMatch(
        /--product\s+[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
      );
    });

    it("renders the rec list exactly once (no Quick actions duplicate block)", async () => {
      const result = await runCliExpectSuccess(
        ["recommendations", "list"],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      const combined = result.stdout + result.stderr;
      // The "Quick actions:" header was the start of the duplicate block.
      // It must not appear in the new human render.
      expect(combined).not.toMatch(/Quick actions:/);
      // The `orders create --product …` snippet was the per-rec second
      // render that carried the UUID leak; it must not appear in human
      // output. (JSON output's `orderCommand` field still has it — that
      // contract is covered by the existing JSON tests above.)
      expect(combined).not.toMatch(/orders create --product/);
      // The drill-in hint stays.
      expect(combined).toMatch(/Walk through all/);
    });

    it("--json output still carries the full orderCommand with product id (agent contract)", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--top", "0"]);
      const data = (JSON.parse(result.stdout) as { recommendations: Array<{ orderCommand: string | null }> }).recommendations;
      const withCommand = data.filter((r) => r.orderCommand);
      expect(withCommand.length).toBeGreaterThan(0);
      // The JSON `orderCommand` MUST still include `--product <id>` so
      // agents and downstream tooling can execute it verbatim. Whether the
      // id is a UUID (real API) or a demo-stub like `prod-xxx-0001` is
      // env-dependent; what we require is that the `--product <token>`
      // shape survives.
      expect(
        withCommand.every((r) => /--product\s+\S+/.test(r.orderCommand!)),
      ).toBe(true);
    });

    // #509: every actionable recommendation carries `orderArgs` alongside
    // `orderCommand`. The argv form is the spawn-safe path that consumers
    // (REPL, recommendations act, dashboard) prefer; the string is
    // display-only. Pinning the shape here so a future regression that
    // drops `orderArgs` from JSON output gets caught.
    it("--json carries orderArgs[] argv-style array alongside orderCommand", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--top", "0"]);
      const data = (JSON.parse(result.stdout) as {
        recommendations: Array<{
          orderCommand: string | null;
          orderArgs: string[] | null;
        }>;
      }).recommendations;
      const actionable = data.filter((r) => r.orderCommand);
      expect(actionable.length).toBeGreaterThan(0);
      for (const rec of actionable) {
        expect(Array.isArray(rec.orderArgs)).toBe(true);
        // Fixed argv0 + subcommand path so the REPL drill-in
        // (`packages/cli/src/lib/repl.ts`) can verify shape before
        // dispatching.
        expect(rec.orderArgs!.slice(0, 3)).toEqual(["pax8", "orders", "create"]);
        // Each element is a single argv slot — no embedded shell
        // quoting / metacharacters / tokenization required.
        expect(rec.orderArgs!.every((a) => typeof a === "string")).toBe(true);
        // Product flag is present in the argv (parallel guarantee to
        // the orderCommand contract above).
        const productIdx = rec.orderArgs!.indexOf("--product");
        expect(productIdx).toBeGreaterThan(0);
        expect(rec.orderArgs![productIdx + 1]).toMatch(/\S/);
      }
    });

    // Path B (#375 precursor): every recommendation carries the additive
    // `opportunityType` axis alongside the legacy `type`, using OE's
    // canonical 5-type taxonomy. The legacy `type` is unchanged.
    it("--json carries both legacy type and additive opportunityType (OE 5-type taxonomy)", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--top", "0"]);
      const data = (JSON.parse(result.stdout) as {
        recommendations: Array<{
          type: string;
          opportunityType: string;
        }>;
      }).recommendations;
      expect(data.length).toBeGreaterThan(0);
      const allowed = new Set(["Upsell", "Cross-sell", "Add-on", "Upgrade", "Net-new"]);
      for (const rec of data) {
        expect(rec).toHaveProperty("type");
        expect(rec).toHaveProperty("opportunityType");
        expect(allowed.has(rec.opportunityType)).toBe(true);
        // Mapping invariants (zero-sub → Net-new is asserted at the engine
        // level; here we just check that seat_gap is always Upsell and
        // cross_sell never becomes Add-on/Upgrade in the v0.x stopgap).
        if (rec.type === "seat_gap") {
          expect(rec.opportunityType).toBe("Upsell");
        }
        if (rec.type === "cross_sell") {
          expect(["Cross-sell", "Net-new"]).toContain(rec.opportunityType);
        }
      }
    });
  });

  describe("recommendations upsell", () => {
    it("returns the upsell cohort as JSON by default", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "upsell",
        "--from-product", "Microsoft 365 Business Basic",
        "--to-product", "Microsoft 365 Business Premium",
        "--json",
      ]);
      const data = JSON.parse(result.stdout) as {
        fromProduct: string;
        toProduct: string;
        matches: Array<{
          companyName: string;
          fromSeats: number;
          fromMrr: number;
          opportunityType: string;
          contacts: Array<{ name: string; email: string }>;
        }>;
        totalFromMrr: number;
        totalFromProductCompanies: number;
        alreadyHaveToProduct: number;
      };
      expect(data.fromProduct).toBe("Microsoft 365 Business Basic");
      expect(data.toProduct).toBe("Microsoft 365 Business Premium");
      expect(Array.isArray(data.matches)).toBe(true);
      // Demo data has companies on Basic without Premium → at least one match.
      expect(data.matches.length).toBeGreaterThan(0);
      for (const m of data.matches) {
        expect(m.opportunityType).toBe("Upsell");
        expect(m.fromSeats).toBeGreaterThan(0);
        expect(Array.isArray(m.contacts)).toBe(true);
      }
    });

    it("returns no matches when no company has the from-product", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "upsell",
        "--from-product", "ThisProductDoesNotExistInDemoData99999",
        "--to-product", "Microsoft 365 Business Premium",
        "--json",
      ]);
      const data = JSON.parse(result.stdout) as {
        matches: unknown[];
        totalFromProductCompanies: number;
      };
      expect(data.matches).toEqual([]);
      expect(data.totalFromProductCompanies).toBe(0);
    });

    it("returns no matches when every from-product company already has to-product", async () => {
      // Force the edge by passing the same product on both sides — every
      // company on Premium trivially "already has" Premium, so the
      // actionable cohort is empty even though the source cohort is not.
      const result = await runCliExpectSuccess([
        "recommendations", "upsell",
        "--from-product", "Microsoft 365 Business Premium",
        "--to-product", "Microsoft 365 Business Premium",
        "--json",
      ]);
      const data = JSON.parse(result.stdout) as {
        matches: unknown[];
        totalFromProductCompanies: number;
        alreadyHaveToProduct: number;
      };
      expect(data.matches).toEqual([]);
      expect(data.totalFromProductCompanies).toBeGreaterThan(0);
      expect(data.alreadyHaveToProduct).toBe(data.totalFromProductCompanies);
    });

    it("errors when --from-product or --to-product is missing", async () => {
      const result = await runCliExpectFailure([
        "recommendations", "upsell",
        "--from-product", "Microsoft 365 Business Basic",
        "--json",
      ]);
      // Commander emits its own required-option message on stderr.
      expect(result.stderr).toMatch(/--to-product|required/i);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe("recommendations act", () => {
    let tmpConfigDir: string;

    beforeEach(async () => {
      tmpConfigDir = await fs.mkdtemp(path.join(os.tmpdir(), "pax8-recs-act-"));
    });

    afterEach(async () => {
      await fs.rm(tmpConfigDir, { recursive: true, force: true });
    });

    // Disclosure parity with `recommendations list` (which already calls out
    // the CLI-local engine, STAX divergence, provisional framing, and
    // ARC-785/#375 sunset). Mirroring that disclosure onto `act` closes a
    // gap Randall Ellis raised in the domain review: bulk order placement
    // against a CLI-side heuristic deserves the same up-front disclosure as
    // the list command it inherits from.
    it("--help discloses the CLI-local heuristic nature and provisional engine status", async () => {
      const result = await runCliExpectSuccess(["recommendations", "act", "--help"]);
      // Names the local engine vs canonical OE
      expect(result.stdout).toContain("CLI-side heuristics");
      expect(result.stdout).toMatch(/canonical Opportunity Explorer|OE/);
      // STAX divergence callout (consistent with `recommendations list --help`)
      expect(result.stdout).toMatch(/STAX|seat_gap/);
      // Provisional framing — names the OE first-party API + ARC-785/#375
      expect(result.stdout).toMatch(/ARC-785|#375|first-party.*API/);
      // Names that bulk action places REAL orders (not a dry run)
      expect(result.stdout).toMatch(/REAL orders|orders API/);
    });

    it("--yes places all recommendations without prompting", async () => {
      const result = await runCliExpectSuccess(
        ["recommendations", "act", "--company", "Bright Minds Academy", "--yes"],
      );
      // Multi-select prompt should not appear at all in --yes mode.
      expect(result.stderr).not.toMatch(/Select recommendations to act on/);
      expect(result.stderr).not.toMatch(/About to place \d+ orders?/);
      // We do expect to see the batch header and the per-order placement output.
      expect(result.stderr).toMatch(/recommendations for batch ordering/);
      // And the summary line at the end.
      expect(result.stderr).toMatch(/ordered/);
    });

    it("non-TTY without --yes errors cleanly with guidance instead of hanging", async () => {
      // Subprocesses spawned by execFile have a non-TTY stdin by default,
      // so this exercises the production guard.
      const result = await runCliExpectFailure(
        ["recommendations", "act", "--company", "Bright Minds Academy"],
      );
      expect(result.stderr).toMatch(/stdin is not a TTY|interactive picker/i);
      // Recovery guidance should mention --yes.
      expect(result.stderr).toMatch(/--yes/);
      // Should be the validated stable code (CliError without explicit code
      // resolves to ERROR_INVALID_INPUT in this command).
      expect(result.exitCode).not.toBe(0);
    });

    it("emits recs_* aggregate counts on the postAction telemetry event with --yes", async () => {
      // Enable telemetry in an isolated config dir so we can read the JSONL
      // backup the CLI writes alongside the PostHog send.
      const configFile = path.join(tmpConfigDir, "config.yaml");
      await fs.writeFile(
        configFile,
        YAML.stringify({
          version: "1.0",
          telemetry: { enabled: true },
        }),
        { encoding: "utf-8", mode: 0o600 },
      );

      const result = await runCli(
        ["recommendations", "act", "--company", "Bright Minds Academy", "--yes"],
        {
          PAX8_CONFIG_DIR: tmpConfigDir,
          // Make sure neither env-var opt-out path silently disables.
          PAX8_TELEMETRY_DISABLED: "",
          DO_NOT_TRACK: "",
        },
      );
      expect(result.exitCode).toBe(0);

      // Telemetry writes a JSONL file under <configDir>/telemetry/<date>.jsonl
      const today = new Date().toISOString().slice(0, 10);
      const jsonlPath = path.join(tmpConfigDir, "telemetry", `${today}.jsonl`);
      const content = await fs.readFile(jsonlPath, "utf-8");
      const events = content
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Record<string, unknown>);
      const cmdEvent = events.find(
        (e) => e.event === "command_executed" && e.subcommand === "recommendations.act",
      );
      expect(cmdEvent).toBeDefined();
      expect(cmdEvent).toMatchObject({
        recs_presented: expect.any(Number),
        recs_ordered: expect.any(Number),
        recs_skipped: expect.any(Number),
      });
      // Bright Minds Academy has at least one actionable rec in demo data,
      // so we should see a positive presented count.
      expect(cmdEvent!.recs_presented as number).toBeGreaterThan(0);
      // recs_mrr_captured is only emitted when >0; if any orders succeeded
      // it should be present and positive.
      if ((cmdEvent!.recs_ordered as number) > 0) {
        expect(cmdEvent!.recs_mrr_captured).toBeDefined();
        expect(cmdEvent!.recs_mrr_captured as number).toBeGreaterThan(0);
      }
    });
  });
});
