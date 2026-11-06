// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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
// and silently returns [] for multi-word values, and pages cap at 100 rows.
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
    const size = Math.min(params.size ?? 10, 100);
    const page = params.page ?? 0;
    return Promise.resolve({
      content: filtered.slice(page * size, (page + 1) * size),
      page: { size, number: page, totalElements: filtered.length, totalPages: Math.ceil(filtered.length / size) },
    });
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

  it("never sends whitespace in the API search param", async () => {
    const ctx = makeMockCtx([makeProduct(), makeProduct({ id: "p2", name: "ObscureVendor Pro Suite" })]);

    await resolveProduct(ctx, "Microsoft 365 Business Premium");
    await resolveProduct(ctx, "ObscureVendor Pro Suite");

    const list = ctx.api.products.list as ReturnType<typeof vi.fn>;
    for (const [args] of list.mock.calls) expect(/\s/.test(args.search ?? "")).toBe(false);
  });

  // #757: the lookup used to scan one page of a single-keyword search, so
  // "only one substring match" meant only one in ~100 rows.
  it("does not pick the one phrase match on page 1 when the catalog has others", async () => {
    const filler = Array.from({ length: 150 }, (_, i) =>
      makeProduct({ id: `f${i}`, name: `Microsoft 365 Filler ${i}` }),
    );
    const products = [
      makeProduct({ id: "addon", name: "Defender Add On for Microsoft 365 E3" }),
      ...filler,
      makeProduct({ id: "e3", name: "Microsoft 365 E3 [New Commerce Experience]" }),
    ];
    const ctx = makeMockCtx(products);

    await expect(resolveProduct(ctx, "Microsoft 365 E3")).rejects.toThrow(/Multiple products match/);
  });

  it("resolves an exact name that sits past the first page", async () => {
    const filler = Array.from({ length: 250 }, (_, i) =>
      makeProduct({ id: `f${i}`, name: `Microsoft 365 Business Filler ${i} [New Commerce Experience]` }),
    );
    const target = makeProduct({ id: "bp", name: "Microsoft 365 Business Premium [New Commerce Experience]" });
    const ctx = makeMockCtx([...filler, target]);

    expect(await resolveProduct(ctx, "Microsoft 365 Business Premium [New Commerce Experience]")).toEqual(target);
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
    // Regression: multi-word `search` values are unreliable on the live API
    // (the mock returns nothing for them). The resolver sends single words
    // only, then exact-matches client-side.
    const product = makeProduct();
    const ctx = makeMockCtx([product]);

    const result = await resolveProduct(ctx, "Microsoft 365 Business Premium");
    expect(result).toEqual(product);

    const list = ctx.api.products.list as ReturnType<typeof vi.fn>;
    const args = list.mock.calls[0][0];
    expect(/\s/.test(args.search)).toBe(false);
  });
});
