// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

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
  it("resolves names via per-id lookup when the missing set is small", async () => {
    // <=25 unique missing IDs: narrow path uses products.get(id) in parallel
    // and avoids the 500-row bulk catalog fetch entirely.
    const subs: MockSub[] = [{ productId: "p1", productName: undefined }];
    const ctx = mockCtx([{ id: "p1", name: "Microsoft 365" }], { p1: "Microsoft 365" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Microsoft 365");
    expect(ctx.api.products.get).toHaveBeenCalledWith("p1");
    expect(ctx.api.products.list).not.toHaveBeenCalled();
  });

  it("uses per-id lookup for individual products on the narrow path", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: undefined }];
    const ctx = mockCtx([], { p1: "Defender for Business" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Defender for Business");
    expect(ctx.api.products.get).toHaveBeenCalledWith("p1");
  });

  it("resolves multiple products in parallel via per-id lookups", async () => {
    const subs: MockSub[] = [
      { productId: "p1", productName: undefined },
      { productId: "p2", productName: undefined },
    ];
    const ctx = mockCtx([], { p1: "M365", p2: "Acronis Backup" });
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("M365");
    expect(subs[1].productName).toBe("Acronis Backup");
    expect(ctx.api.products.list).not.toHaveBeenCalled();
  });

  it("skips subs that already have names", async () => {
    const subs: MockSub[] = [{ productId: "p1", productName: "Already Named" }];
    const ctx = mockCtx([], {});
    await enrichProductNames(ctx, subs);
    expect(subs[0].productName).toBe("Already Named");
    expect(ctx.api.products.list).not.toHaveBeenCalled();
    expect(ctx.api.products.get).not.toHaveBeenCalled();
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

  it("falls back to bulk catalog when the missing set exceeds the per-id threshold", async () => {
    // Build 30 missing subscriptions: > the 25-id threshold triggers the
    // bulk-list path. Catalog covers some, per-id fills the rest.
    const catalogProducts: Array<{ id: string; name: string }> = [];
    const lookups: Record<string, string> = {};
    const subs: MockSub[] = [];
    for (let i = 0; i < 30; i++) {
      const pid = `p${i}`;
      subs.push({ productId: pid, productName: undefined });
      if (i < 20) {
        catalogProducts.push({ id: pid, name: `Catalog ${i}` });
      } else {
        lookups[pid] = `Individual ${i}`;
      }
    }
    const ctx = mockCtx(catalogProducts, lookups);
    await enrichProductNames(ctx, subs);
    expect(ctx.api.products.list).toHaveBeenCalledWith({ size: 500 });
    expect(subs[0].productName).toBe("Catalog 0");
    expect(subs[19].productName).toBe("Catalog 19");
    expect(subs[20].productName).toBe("Individual 20");
    expect(subs[29].productName).toBe("Individual 29");
  });
});
