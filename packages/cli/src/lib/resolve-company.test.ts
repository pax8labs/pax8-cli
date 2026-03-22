import { describe, it, expect, vi, beforeEach } from "vitest";
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
