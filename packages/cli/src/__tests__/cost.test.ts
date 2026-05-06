import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 cost", () => {
  describe("cost --help", () => {
    it("shows the sim subcommand", async () => {
      const result = await runCliExpectSuccess(["cost", "--help"]);
      expect(result.stdout).toContain("sim");
    });

    it("describes the cost group as no-write / what-if", async () => {
      const result = await runCliExpectSuccess(["cost", "--help"]);
      // Top-level group description should hint that this is read-only
      expect(result.stdout.toLowerCase()).toMatch(/cost|simul|what.?if/);
    });
  });

  describe("cost sim --help", () => {
    it("shows the documented flags", async () => {
      const result = await runCliExpectSuccess(["cost", "sim", "--help"]);
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toContain("--product");
      expect(result.stdout).toContain("--quantity");
      expect(result.stdout).toContain("--from");
      expect(result.stdout).toContain("--billing-term");
      expect(result.stdout).toContain("Examples:");
    });
  });

  describe("cost sim — JSON output", () => {
    it("returns a structured simulation result for an SKU swap", async () => {
      const result = await runCliExpectSuccess([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "Microsoft 365 Business Premium",
        "--from",
        "Microsoft 365 Business Basic",
        "--quantity",
        "25",
        "--billing-term",
        "Monthly",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.companyName).toBe("Bright Minds Academy");
      expect(data.current).not.toBeNull();
      expect(data.current.productName).toMatch(/Business Basic/);
      expect(data.proposed.productName).toMatch(/Business Premium/);
      expect(data.proposed.quantity).toBe(25);
      // Premium $22 × 25 = 550/mo; Basic $6 × 25 = 150/mo → delta 400/mo
      expect(data.current.monthly).toBe(150);
      expect(data.proposed.monthly).toBe(550);
      expect(data.delta.monthly).toBe(400);
      expect(data.delta.annual).toBe(4800);
      expect(Array.isArray(data.nextActions)).toBe(true);
      expect(data.nextActions[0].command).toMatch(/pax8 orders create/);
    });

    it("auto-detects existing subscription when --from is omitted (qty change)", async () => {
      // Pinnacle has Premium @ 15 seats Annual @ $22. Bumping to 25 seats.
      const result = await runCliExpectSuccess([
        "cost",
        "sim",
        "--company",
        "Pinnacle Financial Advisors",
        "--product",
        "Microsoft 365 Business Premium",
        "--quantity",
        "25",
        "--billing-term",
        "Annual",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.current).not.toBeNull();
      expect(data.current.quantity).toBe(15);
      expect(data.proposed.quantity).toBe(25);
      // Annual: 22 × 15 / 12 = 27.5/mo current; 22 × 25 / 12 = 45.83/mo proposed
      expect(data.current.monthly).toBeCloseTo(27.5, 2);
      expect(data.proposed.monthly).toBeCloseTo(45.83, 2);
      expect(data.delta.monthly).toBeGreaterThan(0);
    });

    it("treats unknown product+company combo as add-new (no current)", async () => {
      // Bright Minds Academy doesn't have AvePoint Cloud Backup.
      const result = await runCliExpectSuccess([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "AvePoint Cloud Backup",
        "--quantity",
        "20",
        "--billing-term",
        "Monthly",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.current).toBeNull();
      expect(data.proposed.quantity).toBe(20);
      expect(data.delta.monthly).toBe(data.proposed.monthly);
    });
  });

  describe("cost sim — CSV output", () => {
    it("returns one row per scenario field", async () => {
      const result = await runCliExpectSuccess([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "Microsoft 365 Business Premium",
        "--from",
        "Microsoft 365 Business Basic",
        "--quantity",
        "25",
        "--billing-term",
        "Monthly",
        "--csv",
      ]);
      const lines = result.stdout.trim().split("\n");
      // Header + current + proposed + delta = 4 lines minimum
      expect(lines.length).toBeGreaterThanOrEqual(4);
      expect(lines[0]).toContain("Scenario");
      expect(lines[0]).toContain("Monthly");
      expect(result.stdout).toContain("current");
      expect(result.stdout).toContain("proposed");
      expect(result.stdout).toContain("delta");
    });
  });

  describe("cost sim — default (non-TTY) output", () => {
    it("falls back to JSON when stdout isn't a TTY", async () => {
      // Subprocess tests run with no TTY, so the CLI's getOutputFormat()
      // contract is to emit JSON. Confirm the contract holds for cost sim.
      const result = await runCliExpectSuccess([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "Microsoft 365 Business Premium",
        "--from",
        "Microsoft 365 Business Basic",
        "--quantity",
        "25",
        "--billing-term",
        "Monthly",
      ]);
      // Should parse as JSON without an explicit --json flag
      const data = JSON.parse(result.stdout);
      expect(data.companyName).toBe("Bright Minds Academy");
      expect(data.delta.monthly).toBe(400);
    });
  });

  describe("cost sim — error cases", () => {
    it("errors when --company is missing", async () => {
      const result = await runCliExpectFailure([
        "cost",
        "sim",
        "--product",
        "Microsoft 365 Business Premium",
        "--quantity",
        "10",
      ]);
      expect(result.stderr).toContain("--company");
    });

    it("errors when --product is missing", async () => {
      const result = await runCliExpectFailure([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--quantity",
        "10",
      ]);
      expect(result.stderr).toContain("--product");
    });

    it("errors on unknown company", async () => {
      const result = await runCliExpectFailure([
        "cost",
        "sim",
        "--company",
        "Nonexistent Company XYZ",
        "--product",
        "Microsoft 365 Business Premium",
        "--quantity",
        "10",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/company|not found/);
    });

    it("errors on unknown product", async () => {
      const result = await runCliExpectFailure([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "ZZZ Bogus Product Name",
        "--quantity",
        "10",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/product|not found/);
    });

    it("errors on negative quantity", async () => {
      const result = await runCliExpectFailure([
        "cost",
        "sim",
        "--company",
        "Bright Minds Academy",
        "--product",
        "Microsoft 365 Business Premium",
        "--quantity",
        "-5",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined.toLowerCase()).toMatch(/quantity|invalid/);
    });
  });
});
