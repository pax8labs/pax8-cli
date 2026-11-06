// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import { searchProducts } from "./product-search.js";
import type { CommandContext } from "./context.js";

interface ListParams {
  vendorName?: string;
  search?: string;
  size?: number;
  page?: number;
}

function product(i: number, name: string, vendorName = "Microsoft") {
  return { id: `prod-${i}`, name, vendorName, sku: `SKU-${i}`, unitOfMeasure: "seat", pricing: [] };
}

// Mirrors the live /products endpoint: single-word `search` substring match,
// vendor narrowing, and a hard 100-row page cap regardless of `size`.
function makeCtx(catalog: ReturnType<typeof product>[]) {
  const list = vi.fn().mockImplementation(async (params: ListParams = {}) => {
    let rows = catalog;
    if (params.vendorName) rows = rows.filter((p) => p.vendorName === params.vendorName);
    if (params.search) {
      const s = params.search.toLowerCase();
      rows = rows.filter((p) => p.name.toLowerCase().includes(s));
    }
    const size = Math.min(params.size ?? 10, 100);
    const page = params.page ?? 0;
    return {
      content: rows.slice(page * size, (page + 1) * size),
      page: { size, number: page, totalElements: rows.length, totalPages: Math.ceil(rows.length / size) },
    };
  });
  return { ctx: { api: { products: { list } } } as unknown as CommandContext, list };
}

// 300 "Microsoft …" products ahead of the one the user wants — the live
// shape that made "Microsoft 365 Business Premium" return nothing (#757).
const filler = Array.from({ length: 300 }, (_, i) => product(i, `Microsoft Filler ${i}`));
const target = product(999, "Microsoft 365 Business Premium [New Commerce Experience]");
const catalog = [...filler, target];

describe("searchProducts", () => {
  it("finds a multi-word product the longest word's first page never reaches", async () => {
    const { ctx } = makeCtx(catalog);
    const { products } = await searchProducts(ctx, "Microsoft 365 Business Premium");
    expect(products.map((p) => p.id)).toEqual(["prod-999"]);
  });

  it("pages through the rarest word, not the longest", async () => {
    const { ctx, list } = makeCtx(catalog);
    await searchProducts(ctx, "Microsoft Premium");
    const paged = list.mock.calls.map(([p]) => p).filter((p: ListParams) => p.size !== 1);
    expect(paged.map((p: ListParams) => p.search)).toEqual(["premium"]);
  });

  it("walks every page for a one-word query", async () => {
    const { ctx, list } = makeCtx(catalog);
    const { products, truncated } = await searchProducts(ctx, "Microsoft");
    expect(products).toHaveLength(301);
    expect(truncated).toBe(false);
    expect(list).toHaveBeenCalledTimes(4);
  });

  it("returns nothing without paging when any word has no matches", async () => {
    const { ctx, list } = makeCtx(catalog);
    const { products } = await searchProducts(ctx, "Microsoft Nonexistent");
    expect(products).toEqual([]);
    expect(list.mock.calls.every(([p]) => p.size === 1)).toBe(true);
  });

  it("matches words in any order, case-insensitively", async () => {
    const { ctx } = makeCtx(catalog);
    const { products } = await searchProducts(ctx, "premium BUSINESS 365");
    expect(products.map((p) => p.id)).toEqual(["prod-999"]);
  });

  it("passes the vendor filter to every request", async () => {
    const { ctx, list } = makeCtx([...catalog, product(1000, "Acronis Premium Backup", "Acronis")]);
    const { products } = await searchProducts(ctx, "Premium", { vendorName: "Acronis" });
    expect(products.map((p) => p.id)).toEqual(["prod-1000"]);
    expect(list.mock.calls.every(([p]) => p.vendorName === "Acronis")).toBe(true);
  });

  it("flags truncation past the row cap", async () => {
    const big = Array.from({ length: 3_050 }, (_, i) => product(i, `Widget ${i}`));
    const { ctx } = makeCtx(big);
    const { products, truncated } = await searchProducts(ctx, "Widget");
    expect(truncated).toBe(true);
    expect(products).toHaveLength(3_000);
  });
});
