// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { fetchAll, type DashboardFetchedData } from "./dashboard.js";

/**
 * Unit-level coverage for `dashboard.ts`'s `fetchAll` partial-failure
 * logic (#635). Symmetric with `today.fetch.test.ts` — see that file's
 * header comment for the why. The two helpers fetch slightly different
 * feeds (orders vs invoices+invoice line items), but both follow the
 * same `Promise.allSettled → collect WarningRecord[] → return` shape.
 */

interface FeedControl {
  companies?: "ok" | "fail";
  products?: "ok" | "fail";
  orders?: "ok" | "fail";
  subs?: "ok" | "fail";
}

function buildFakeCtx(control: FeedControl) {
  const okPage = { content: [], page: { number: 0, size: 0, totalPages: 0, totalElements: 0 } };
  async function* okStream() {
    yield { content: [], page: { number: 0, size: 0, totalPages: 1, totalElements: 0 } };
  }
  async function* failStream() {
    throw new Error("stream blew up");
    // eslint-disable-next-line no-unreachable
    yield okPage;
  }
  return {
    api: {
      companies: {
        list: async () => {
          if (control.companies === "fail") throw new Error("companies down");
          return okPage;
        },
      },
      products: {
        list: async () => {
          if (control.products === "fail") throw new Error("products down");
          return okPage;
        },
      },
      orders: {
        list: async () => {
          if (control.orders === "fail") throw new Error("orders down");
          return okPage;
        },
      },
      subscriptions: {
        streamAll: () => (control.subs === "fail" ? failStream() : okStream()),
      },
    },
  };
}

function silentSpinner() {
  return {
    text: "",
    start() { return this; },
    stop() { return this; },
    succeed() { return this; },
    fail() { return this; },
  };
}

async function run(control: FeedControl): Promise<DashboardFetchedData> {
  const ctx = buildFakeCtx(control) as unknown as Parameters<typeof fetchAll>[0];
  const spinner = silentSpinner() as unknown as Parameters<typeof fetchAll>[1];
  return await fetchAll(ctx, spinner);
}

describe("dashboard.ts fetchAll — warning collection (#635)", () => {
  it("returns an empty warnings[] when every feed resolves", async () => {
    const result = await run({});
    expect(result.warnings).toEqual([]);
    expect(result.allSubs).toEqual([]);
    expect(result.companiesResult.content).toEqual([]);
    expect(result.productsResult.content).toEqual([]);
    expect(result.ordersResult.content).toEqual([]);
  });

  it("collects a warning when companies fails", async () => {
    const result = await run({ companies: "fail" });
    expect(result.warnings).toEqual([
      { feed: "companies", severity: "warn", message: "Could not load companies" },
    ]);
  });

  it("collects a warning when subscriptions fails", async () => {
    // Dashboard's subs-failure severity is "warn" (not "error" like today.ts).
    // The two commands made independent UX calls about how to escalate the
    // primary feed — the refactor preserves both verbatim.
    const result = await run({ subs: "fail" });
    expect(result.warnings).toEqual([
      { feed: "subscriptions", severity: "warn", message: "Could not load subscriptions" },
    ]);
  });

  it("collects a warning when products fails", async () => {
    const result = await run({ products: "fail" });
    expect(result.warnings).toEqual([
      { feed: "products", severity: "warn", message: "Could not load products" },
    ]);
  });

  it("does NOT warn on orders failure — orders are best-effort here", async () => {
    // The pre-refactor inline block tracked companies/subs/products but not
    // orders (the recent-activity render gracefully degrades to empty).
    // The refactor preserves that exact tracking surface.
    const result = await run({ orders: "fail" });
    expect(result.warnings).toEqual([]);
    expect(result.ordersResult.content).toEqual([]);
  });

  it("collects warnings in the documented order across multiple failures", async () => {
    const result = await run({ companies: "fail", subs: "fail", products: "fail" });
    expect(result.warnings.map((w) => w.feed)).toEqual([
      "companies",
      "subscriptions",
      "products",
    ]);
    expect(result.warnings.every((w) => w.severity === "warn")).toBe(true);
  });
});
