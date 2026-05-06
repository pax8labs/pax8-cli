import { describe, it, expect, vi } from "vitest";
import { resolveProduct } from "./resolve-product.js";
import type { CommandContext } from "./context.js";

function makeProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "prod-m365-biz-prem-0001",
    name: "Microsoft 365 Business Premium",
    vendorName: "Microsoft",
    sku: "M365-BP",
    shortDescription: "Premium plan",
    unitOfMeasure: "seat",
    pricing: [],
    ...overrides,
  };
}

interface ListParams {
  vendorName?: string;
  search?: string;
  size?: number;
  page?: number;
}

// Mock list() that mirrors the real API's filtering: vendorName narrows
// by vendor (substring), search is a single-word substring against name
// and silently returns [] for multi-word values.
function makeMockCtx(products: ReturnType<typeof makeProduct>[] = []): CommandContext {
  const list = vi.fn().mockImplementation((params: ListParams = {}) => {
    let filtered = products;
    if (params.vendorName) {
      const v = params.vendorName.toLowerCase();
      filtered = filtered.filter((p) => p.vendorName.toLowerCase().includes(v));
    }
    if (params.search) {
      const s = params.search.toLowerCase();
      const isSingleWord = !/\s/.test(s);
      filtered = isSingleWord
        ? filtered.filter((p) => p.name.toLowerCase().includes(s))
        : [];
    }
    return Promise.resolve({ content: filtered });
  });

  return {
    api: {
      products: {
        get: vi.fn().mockImplementation((id: string) => {
          const found = products.find((p) => p.id === id);
          if (found) return Promise.resolve(found);
          return Promise.reject(new Error("Not found"));
        }),
        list,
      },
    },
    isDemo: true,
    outputFormat: "json",
  } as unknown as CommandContext;
}

describe("resolveProduct", () => {
  it("UUID input returns product directly via get", async () => {
    const product = makeProduct({ id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890" });
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(result).toEqual(product);
    expect(ctx.api.products.get).toHaveBeenCalledWith("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(ctx.api.products.list).not.toHaveBeenCalled();
  });

  it("dashed non-UUID ID tries get first", async () => {
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "prod-m365-biz-prem-0001");
    expect(result).toEqual(product);
    expect(ctx.api.products.get).toHaveBeenCalledWith("prod-m365-biz-prem-0001");
  });

  it("name input resolves via list + exact match (case-insensitive)", async () => {
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "microsoft 365 business premium");
    expect(result).toEqual(product);
    expect(ctx.api.products.list).toHaveBeenCalled();
  });

  it("name input resolves via substring when only one match", async () => {
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "Business Premium");
    expect(result).toEqual(product);
  });

  it("throws when multiple products match substring", async () => {
    const products = [
      makeProduct({ id: "p1", name: "Microsoft 365 Business Premium" }),
      makeProduct({ id: "p2", name: "Microsoft 365 Business Basic" }),
    ];
    const ctx = makeMockCtx(products);

    await expect(resolveProduct(ctx, "Microsoft 365 Business")).rejects.toThrow(
      /Multiple products match/,
    );
  });

  it("throws descriptive error with search suggestion when not found", async () => {
    const ctx = makeMockCtx([makeProduct()]);

    await expect(resolveProduct(ctx, "NonExistent Product")).rejects.toThrow(
      /Product not found: "NonExistent Product"/,
    );
  });

  it("falls back to name search when dashed ID get fails", async () => {
    const product = makeProduct({ id: "real-id", name: "Some-Dashed-Name Product" });
    const ctx = makeMockCtx([product]);
    (ctx.api.products.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Not found"));

    const result = await resolveProduct(ctx, "Some-Dashed-Name Product");
    expect(result).toEqual(product);
    expect(ctx.api.products.list).toHaveBeenCalled();
  });

  it("uses vendorName + single-keyword search for multi-word names with known vendor", async () => {
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    await resolveProduct(ctx, "Microsoft 365 Business Premium");

    const list = ctx.api.products.list as ReturnType<typeof vi.fn>;
    const args = list.mock.calls[0][0];
    expect(args.vendorName).toBe("Microsoft");
    // longest non-stopword in "365 Business Premium" is "Business" (8 chars)
    expect(args.search).toBe("Business");
    expect(/\s/.test(args.search)).toBe(false);
  });

  it("falls back to keyword-only search when vendor is unknown", async () => {
    const product = makeProduct({ name: "ObscureVendor Pro Suite" });
    const ctx = makeMockCtx([product]);

    await resolveProduct(ctx, "ObscureVendor Pro Suite");

    const list = ctx.api.products.list as ReturnType<typeof vi.fn>;
    const args = list.mock.calls[0][0];
    expect(args.vendorName).toBeUndefined();
    expect(args.search).toBeTruthy();
    expect(/\s/.test(args.search)).toBe(false);
  });

  it("matches against products returned only when each input token appears in the name", async () => {
    // Product name doesn't contain "Microsoft 365 Business Premium" as a
    // contiguous substring (different word order), but every input token
    // appears in the name — token-match fallback should resolve it.
    const product = makeProduct({
      name: "Microsoft Business Premium for 365",
    });
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "Microsoft 365 Business Premium");
    expect(result).toEqual(product);
  });

  it("recovers when API search keyword filters out the target — mirrors the live-API bug", async () => {
    // Regression: the live API treats whitespace in `search` as zero
    // results. Our resolver picks a single keyword ("Business") so the
    // API still returns the product, then exact-matches client-side.
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "Microsoft 365 Business Premium");
    expect(result).toEqual(product);

    const list = ctx.api.products.list as ReturnType<typeof vi.fn>;
    const args = list.mock.calls[0][0];
    expect(/\s/.test(args.search)).toBe(false);
  });
});
