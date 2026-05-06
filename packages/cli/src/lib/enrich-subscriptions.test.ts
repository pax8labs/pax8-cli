import { describe, it, expect, vi } from "vitest";
import { enrichProductNames } from "./enrich-subscriptions.js";
import type { CommandContext } from "./context.js";

type MockSub = { productId: string; productName?: string };

function mockCtx(catalogProducts: Array<{ id: string; name: string }>, individualLookups: Record<string, string>) {
  return {
    api: {
      products: {
        list: vi.fn().mockResolvedValue({ content: catalogProducts }),
        get: vi.fn().mockImplementation(async (id: string) => {
          const name = individualLookups[id];
          if (!name) throw new Error("404");
          return { id, name };
        }),
      },
    },
  } as unknown as CommandContext & {
    api: { products: { list: ReturnType<typeof vi.fn>; get: ReturnType<typeof vi.fn> } };
  };
}

describe("enrichProductNames", () => {
  it("resolves names from bulk catalog", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: undefined }];
    const ctx = mockCtx([{ id: "p1", name: "Microsoft 365" }], {});
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Microsoft 365");
    expect(ctx.api.products.get).not.toHaveBeenCalled();
  });

  it("falls back to individual lookup when not in catalog", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: undefined }];
    const ctx = mockCtx([], { p1: "Defender for Business" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Defender for Business");
    expect(ctx.api.products.get).toHaveBeenCalledWith("p1");
  });

  it("uses catalog for some and individual for others", async () => {
    const subs: MockSub[] = [
      { productId: "p1", productName: undefined },
      { productId: "p2", productName: undefined },
    ];
    const ctx = mockCtx([{ id: "p1", name: "M365" }], { p2: "Acronis Backup" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("M365");
    expect(subs[1].productName).toBe("Acronis Backup");
  });

  it("skips subs that already have names", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: "Already Named" }];
    const ctx = mockCtx([], {});
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Already Named");
    expect(ctx.api.products.list).not.toHaveBeenCalled();
  });

  it("handles individual lookup 404 gracefully", async () => {
    const subs: MockSub[] = [
      { productId: "good", productName: undefined },
      { productId: "gone", productName: undefined },
    ];
    const ctx = mockCtx([], { good: "Good Product" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Good Product");
    expect(subs[1].productName).toBeUndefined();
  });

  it("handles bulk fetch failure and falls back entirely", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: undefined }];
    const ctx = {
      api: {
        products: {
          list: vi.fn().mockRejectedValue(new Error("network error")),
          get: vi.fn().mockResolvedValue({ id: "p1", name: "Fallback Product" }),
        },
      },
    } as unknown as CommandContext;
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Fallback Product");
  });
});
