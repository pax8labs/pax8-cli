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

function makeMockCtx(products: ReturnType<typeof makeProduct>[] = []): CommandContext {
  return {
    api: {
      products: {
        get: vi.fn().mockImplementation((id: string) => {
          const found = products.find((p) => p.id === id);
          if (found) return Promise.resolve(found);
          return Promise.reject(new Error("Not found"));
        }),
        list: vi.fn().mockResolvedValue({ content: products }),
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

    await expect(resolveProduct(ctx, "Microsoft 365")).rejects.toThrow(
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
    // get will reject for the input but the product exists in list
    (ctx.api.products.get as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Not found"));

    const result = await resolveProduct(ctx, "Some-Dashed-Name Product");
    expect(result).toEqual(product);
    expect(ctx.api.products.list).toHaveBeenCalled();
  });
});
