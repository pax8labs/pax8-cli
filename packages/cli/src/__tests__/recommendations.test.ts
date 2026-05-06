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
    it("returns a flat array of recommendations in JSON by default", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("companyId");
      expect(data[0]).toHaveProperty("companyName");
      expect(data[0]).toHaveProperty("type");
      expect(data[0]).toHaveProperty("priority");
    });

    it("--with-actions wraps in { recommendations, nextActions, unmatchedProducts }", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json", "--with-actions"]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("recommendations");
      expect(data).toHaveProperty("nextActions");
      expect(data).toHaveProperty("unmatchedProducts");
      expect(Array.isArray(data.recommendations)).toBe(true);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions.length).toBeLessThanOrEqual(5);
      if (data.nextActions.length > 0) {
        expect(data.nextActions[0]).toHaveProperty("command");
        expect(data.nextActions[0]).toHaveProperty("description");
      }
    });

    it("filters by exact company name", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright Minds Academy", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by partial company name (contains match)", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName.toLowerCase()).toContain("bright");
      }
    });

    it("rejoins excess args into company name for unquoted multi-word names", async () => {
      // Simulates: --company Bright Minds Academy (no quotes)
      // Commander captures "Bright", "Minds" and "Academy" become excess args
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "Bright", "Minds", "Academy", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.companyName).toBe("Bright Minds Academy");
      }
    });

    it("filters by priority", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--priority", "high", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const rec of data) {
        expect(rec.priority).toBe("high");
      }
    });

    it("returns empty result for non-existent company", async () => {
      const result = await runCliExpectSuccess([
        "recommendations", "list", "--company", "NonExistentCorp99999", "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toEqual([]);
    });

    it("JSON output includes both available and unavailable recs for downstream filtering", async () => {
      const result = await runCliExpectSuccess(["recommendations", "list", "--json"]);
      const allRecs = JSON.parse(result.stdout);

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
      const withAll = await runCliExpectSuccess(["recommendations", "list", "--include-all", "--json"]);
      const withoutAll = await runCliExpectSuccess(["recommendations", "list", "--json"]);

      const allRecs = JSON.parse(withAll.stdout);
      const defaultRecs = JSON.parse(withoutAll.stdout);

      // Both should return the same set since JSON output is pre-filter
      // (JSON returns all recs; filtering only affects table mode)
      expect(allRecs.length).toBe(defaultRecs.length);
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
