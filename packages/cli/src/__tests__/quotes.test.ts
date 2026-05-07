// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 quotes", () => {
  describe("quotes list", () => {
    it("returns quote data in JSON format", async () => {
      const result = await runCliExpectSuccess(["quotes", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("companyId");
      expect(data[0]).toHaveProperty("status");
      expect(data[0]).toHaveProperty("createdDate");
    });

    it("filters by lowercase status (matches API enum)", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "list",
        "--status",
        "accepted",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const quote of data) {
        expect(String(quote.status).toLowerCase()).toBe("accepted");
      }
    });

    it("filters by declined status", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "list",
        "--status",
        "declined",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.length).toBeGreaterThan(0);
      for (const quote of data) {
        expect(String(quote.status).toLowerCase()).toBe("declined");
      }
    });

    it("--status help text uses lowercase API enum values", async () => {
      const result = await runCliExpectSuccess(["quotes", "list", "--help"]);
      expect(result.stdout).toContain("draft");
      expect(result.stdout).toContain("sent");
      expect(result.stdout).toContain("accepted");
      expect(result.stdout).toContain("declined");
    });
  });

  describe("quotes show", () => {
    it("includes acceptedBy and respondedOn on an accepted quote (--json)", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "show",
        "quote-redwood-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("quote-redwood-001");
      expect(data.status).toBe("Accepted");
      expect(data.acceptedBy).toBeDefined();
      expect(data.acceptedBy.name).toBe("Karen Olsen");
      expect(data.acceptedBy.email).toBe("karen.olsen@redwoodmfg.example.com");
      expect(data.respondedOn).toBeDefined();
      expect(data.referenceCode).toBe("Q-2026-002");
      expect(data.intentType).toBe("PARTNER_TO_CLIENT");
      expect(typeof data.salesMarginPercentage).toBe("number");
    });

    it("includes declinedBy on a declined quote (--json)", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "show",
        "quote-coastline-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("quote-coastline-001");
      expect(data.status).toBe("Declined");
      expect(data.declinedBy).toBeDefined();
      expect(data.declinedBy.name).toBe("Marco Reyes");
      expect(data.respondedOn).toBeDefined();
    });

    it("draft quote --json omits the accept/decline workflow fields", async () => {
      const result = await runCliExpectSuccess([
        "quotes",
        "show",
        "quote-bright-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.status).toBe("Draft");
      expect(data.acceptedBy).toBeUndefined();
      expect(data.declinedBy).toBeUndefined();
      expect(data.respondedOn).toBeUndefined();
    });
  });

  describe("quotes --help", () => {
    it("shows quotes subcommands", async () => {
      const result = await runCliExpectSuccess(["quotes", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
    });
  });
});
