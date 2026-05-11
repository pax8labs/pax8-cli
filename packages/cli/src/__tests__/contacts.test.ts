// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

const SUMMIT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

describe("pax8 contacts", () => {
  // ─── nested wire path / `--company` requirement (#324) ─────────────────

  describe("contacts list", () => {
    it("lists contacts for a company", async () => {
      const result = await runCliExpectSuccess([
        "contacts",
        "list",
        "--company",
        SUMMIT_ID,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      for (const c of data) {
        expect(c.companyId).toBe(SUMMIT_ID);
      }
    });
  });

  describe("contacts show", () => {
    it("requires --company", async () => {
      const result = await runCliExpectFailure([
        "contacts",
        "show",
        "contact-summit-001",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/--company is required/);
      expect(combined).toMatch(/Contacts in v2 must be addressed under a company/);
    });

    it("returns the contact when --company is provided", async () => {
      const result = await runCliExpectSuccess([
        "contacts",
        "show",
        "contact-summit-001",
        "--company",
        SUMMIT_ID,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("contact-summit-001");
      expect(data.companyId).toBe(SUMMIT_ID);
    });

    it("shows the migration note in --help", async () => {
      const result = await runCliExpectSuccess(["contacts", "show", "--help"]);
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toMatch(/companies\/\{companyId\}\/contacts/);
    });
  });

  describe("contacts create --type", () => {
    it("accepts a single ContactType (default Admin)", async () => {
      const result = await runCliExpectSuccess(
        [
          "contacts",
          "create",
          "--company",
          SUMMIT_ID,
          "--email",
          "single@example.com",
          "--first-name",
          "Single",
          "--last-name",
          "Type",
          "--json",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].types).toEqual(["Admin"]);
      expect(data[0].companyId).toBe(SUMMIT_ID);
    });

    it("accepts comma-separated multiple ContactTypes", async () => {
      const result = await runCliExpectSuccess(
        [
          "contacts",
          "create",
          "--company",
          SUMMIT_ID,
          "--email",
          "multi@example.com",
          "--first-name",
          "Multi",
          "--last-name",
          "Type",
          "--type",
          "Admin,Billing",
          "--json",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].types).toEqual(["Admin", "Billing"]);
    });

    it("trims whitespace and dedupes types", async () => {
      const result = await runCliExpectSuccess(
        [
          "contacts",
          "create",
          "--company",
          SUMMIT_ID,
          "--email",
          "trim@example.com",
          "--first-name",
          "Trim",
          "--last-name",
          "Dedup",
          "--type",
          " Admin , Billing , Admin ",
          "--json",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const data = JSON.parse(result.stdout);
      expect(data[0].types).toEqual(["Admin", "Billing"]);
    });

    it("rejects invalid type values", async () => {
      const result = await runCliExpectFailure(
        [
          "contacts",
          "create",
          "--company",
          SUMMIT_ID,
          "--email",
          "bad@example.com",
          "--first-name",
          "Bad",
          "--last-name",
          "Type",
          "--type",
          "Admin,Bogus",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Invalid --type/);
      expect(combined).toContain("Bogus");
    });

    it("shows the new --type help text", async () => {
      const result = await runCliExpectSuccess(["contacts", "create", "--help"]);
      expect(result.stdout).toContain("--type");
      expect(result.stdout).toContain("Comma-separated");
      expect(result.stdout).toContain("Admin");
      expect(result.stdout).toContain("Billing");
      expect(result.stdout).toContain("Technical");
    });
  });

  describe("contacts update", () => {
    it("requires --company", async () => {
      const result = await runCliExpectFailure(
        [
          "contacts",
          "update",
          "contact-summit-001",
          "--email",
          "x@example.com",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/--company is required/);
      expect(combined).toMatch(/Contacts in v2 must be addressed under a company/);
    });

    it("accepts comma-separated multiple ContactTypes", async () => {
      const result = await runCliExpectSuccess(
        [
          "contacts",
          "update",
          "contact-summit-001",
          "--company",
          SUMMIT_ID,
          "--type",
          "Admin,Technical",
          "--json",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].types).toEqual(["Admin", "Technical"]);
    });

    it("rejects an empty --type value", async () => {
      const result = await runCliExpectFailure(
        [
          "contacts",
          "update",
          "contact-summit-001",
          "--company",
          SUMMIT_ID,
          "--type",
          " , ,",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/At least one contact type is required/);
    });

    it("rejects invalid type values", async () => {
      const result = await runCliExpectFailure(
        [
          "contacts",
          "update",
          "contact-summit-001",
          "--company",
          SUMMIT_ID,
          "--type",
          "Admin,NotReal",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Invalid --type/);
      expect(combined).toContain("NotReal");
    });
  });

  describe("contacts delete", () => {
    it("requires --company", async () => {
      const result = await runCliExpectFailure(
        [
          "contacts",
          "delete",
          "contact-summit-001",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/--company is required/);
      expect(combined).toMatch(/Contacts in v2 must be addressed under a company/);
    });

    it("deletes when --company is provided", async () => {
      const result = await runCliExpectSuccess(
        [
          "contacts",
          "delete",
          "contact-summit-001",
          "--company",
          SUMMIT_ID,
          "--json",
          "--yes",
        ],
        { PAX8_YES: "1" },
      );
      const data = JSON.parse(result.stdout);
      expect(data[0].id).toBe("contact-summit-001");
      expect(data[0].status).toBe("Deleted");
    });
  });
});
