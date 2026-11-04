// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { resolveCompany, resolveCompanyId } from "./resolve-company.js";
import type { CommandContext } from "./context.js";

// Mock last-list so numeric resolution doesn't interfere
vi.mock("./last-list.js", () => ({
  resolveFromLastList: vi.fn().mockResolvedValue(null),
}));

function makeCompany(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    name: "Summit Healthcare Partners",
    address: { street: "", city: "", stateOrProvince: "", postalCode: "", country: "" },
    phone: "",
    ...overrides,
  };
}

function makeMockCtx(companies: ReturnType<typeof makeCompany>[] = []): CommandContext {
  return {
    api: {
      companies: {
        get: vi.fn().mockImplementation((id: string) => {
          const found = companies.find((c) => c.id === id);
          if (found) return Promise.resolve(found);
          return Promise.reject(new Error("Not found"));
        }),
        list: vi.fn().mockResolvedValue({ content: companies }),
      },
    },
    isDemo: true,
    outputFormat: "json",
  } as unknown as CommandContext;
}

describe("resolveCompany", () => {
  it("UUID input returns company directly via get", async () => {
    const company = makeCompany();
    const ctx = makeMockCtx([company]);

    const result = await resolveCompany(ctx, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result).toEqual(company);
    expect(ctx.api.companies.get).toHaveBeenCalledWith("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    // Should NOT call list for UUID input
    expect(ctx.api.companies.list).not.toHaveBeenCalled();
  });

  // #519: the large demo fixture issues IDs of the form
  // `co-<uuid>` (e.g. `co-9e3779b1-9e37-79b1-00009e3779b10000`). The
  // pre-fix `^`-anchored hex check missed the leading `co-` and
  // dropped these lookups through to name-search, which truncated the
  // 1000-company portfolio at the first 200 entries and produced
  // "Could not load company summary" for any company past the cutoff.
  it("prefixed demo ID (co-<uuid>) is treated as ID, not name (#519)", async () => {
    const demoId = "co-9e3779b1-9e37-79b1-00009e3779b10000";
    const company = makeCompany({ id: demoId, name: "Stonebridge Limited" });
    const ctx = makeMockCtx([company]);

    const result = await resolveCompany(ctx, demoId);
    expect(result).toEqual(company);
    expect(ctx.api.companies.get).toHaveBeenCalledWith(demoId);
    // The whole point of the fix: no fall-through to the name-search
    // path that truncates the company list.
    expect(ctx.api.companies.list).not.toHaveBeenCalled();
  });

  it("name input resolves via list + exact match (case-insensitive)", async () => {
    const company = makeCompany();
    const ctx = makeMockCtx([company]);

    const result = await resolveCompany(ctx, "summit healthcare partners");
    expect(result).toEqual(company);
    expect(ctx.api.companies.list).toHaveBeenCalled();
  });

  it("name input resolves via substring match when only one match", async () => {
    const company = makeCompany();
    const ctx = makeMockCtx([company]);

    const result = await resolveCompany(ctx, "Summit Health");
    expect(result).toEqual(company);
  });

  it("throws when multiple companies match substring", async () => {
    const companies = [
      makeCompany({ id: "id-1", name: "Summit Healthcare Partners" }),
      makeCompany({ id: "id-2", name: "Summit Healthcare Solutions" }),
    ];
    const ctx = makeMockCtx(companies);

    await expect(resolveCompany(ctx, "Summit")).rejects.toThrow(/Multiple companies match/);
  });

  it("lists all matches inline when fuzzy match count is ≤10 (#520)", async () => {
    // 8 matches — under the 10 cap, so every name should appear with no
    // "and N more" tail.
    const companies = Array.from({ length: 8 }, (_, i) =>
      makeCompany({ id: `id-${i}`, name: `Acme ${i}` })
    );
    const ctx = makeMockCtx(companies);

    let caught: unknown;
    try {
      await resolveCompany(ctx, "Acme");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { causes?: string[] };
    expect(e.causes).toBeDefined();
    const matchesLine = e.causes![0];
    // All 8 names must surface; no truncation tail.
    for (let i = 0; i < 8; i++) {
      expect(matchesLine).toContain(`Acme ${i}`);
    }
    expect(matchesLine).not.toMatch(/and \d+ more/);
  });

  it("truncates at 10 with 'and N more' hint when fuzzy match count >10 (#520)", async () => {
    // 15 matches — over the cap. First 10 should surface, last 5 collapse
    // into the "and 5 more" tail with a grep recovery hint.
    const companies = Array.from({ length: 15 }, (_, i) =>
      makeCompany({ id: `id-${i}`, name: `Acme ${String(i).padStart(2, "0")}` })
    );
    const ctx = makeMockCtx(companies);

    let caught: unknown;
    try {
      await resolveCompany(ctx, "Acme");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { causes?: string[] };
    const matchesLine = e.causes![0];
    expect(matchesLine).toMatch(/… and 5 more/);
    expect(matchesLine).toContain('grep "Acme"');
    // First and tenth should be present; eleventh must NOT appear inline.
    expect(matchesLine).toContain("Acme 00");
    expect(matchesLine).toContain("Acme 09");
    expect(matchesLine).not.toMatch(/Acme 10[,\b]|Acme 10$/);
  });

  it("throws descriptive error when name not found", async () => {
    const ctx = makeMockCtx([makeCompany()]);

    await expect(resolveCompany(ctx, "NonExistent Corp")).rejects.toThrow(
      /Company not found: "NonExistent Corp"/,
    );
  });

  it("demo name with [DEMO] prefix matches via substring", async () => {
    const company = makeCompany({ name: "[DEMO] Supernova IT" });
    const ctx = makeMockCtx([company]);

    const result = await resolveCompany(ctx, "Supernova");
    expect(result).toEqual(company);
  });
});

describe("resolveCompanyId", () => {
  it("returns just the company ID", async () => {
    const company = makeCompany();
    const ctx = makeMockCtx([company]);

    const id = await resolveCompanyId(ctx, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
  });
});
