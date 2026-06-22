// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { fetchAll, type FetchedData } from "./today.js";

/**
 * Unit-level coverage for `today.ts`'s `fetchAll` partial-failure logic
 * (#635). The helper used to write warnings directly to `process.stderr`,
 * which made the failure paths only testable via subprocess. After the
 * refactor it returns `warnings: WarningRecord[]` alongside the data —
 * the four feeds × {fulfilled, rejected} truth table is now testable
 * here without spinning a child process or stubbing chalk/I/O.
 *
 * We build a structural fake `ctx.api` rather than `MockPax8Client` so we
 * can independently control each feed's resolved/rejected state.
 */

interface FeedControl {
  companies?: "ok" | "fail";
  products?: "ok" | "fail";
  invoices?: "ok" | "fail";
  subs?: "ok" | "fail";
}

function buildFakeCtx(control: FeedControl) {
  const okPage = { content: [], page: { number: 0, size: 0, totalPages: 0, totalElements: 0 } };
  // streamAll yields PaginatedResponse pages; an "ok" stream emits one empty
  // page, a "fail" stream rejects on the first iteration.
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
      invoices: {
        list: async () => {
          if (control.invoices === "fail") throw new Error("invoices down");
          return okPage;
        },
        listItems: async () => ({ content: [] }),
      },
      subscriptions: {
        streamAll: () => (control.subs === "fail" ? failStream() : okStream()),
      },
    },
  };
}

function silentSpinner() {
  // Minimal Ora-shaped no-op spinner. `collectSubsWithSpinner` only writes
  // to `.text`, so a setter is enough.
  return {
    text: "",
    start() { return this; },
    stop() { return this; },
    succeed() { return this; },
    fail() { return this; },
  };
}

async function run(control: FeedControl): Promise<FetchedData> {
  // `fetchAll` is typed against the real buildContext return shape; the
  // structural fake matches the runtime shape exactly. Cast through unknown
  // to silence the nominal class-brand mismatch.
  const ctx = buildFakeCtx(control) as unknown as Parameters<typeof fetchAll>[0];
  const spinner = silentSpinner() as unknown as Parameters<typeof fetchAll>[1];
  return await fetchAll(ctx, spinner);
}

describe("today.ts fetchAll — warning collection (#635)", () => {
  it("returns an empty warnings[] when every feed resolves", async () => {
    const result = await run({});
    expect(result.warnings).toEqual([]);
    expect(result.allSubs).toEqual([]);
    expect(result.companies).toEqual([]);
    expect(result.products).toEqual([]);
    expect(result.invoiceItems).toEqual([]);
  });

  it("collects a warn-severity record when companies fails", async () => {
    const result = await run({ companies: "fail" });
    expect(result.warnings).toEqual([
      {
        feed: "companies",
        severity: "warn",
        message: "Could not load companies — names may render as IDs",
      },
    ]);
  });

  it("collects a warn-severity record when products fails", async () => {
    const result = await run({ products: "fail" });
    expect(result.warnings).toEqual([
      {
        feed: "products",
        severity: "warn",
        message: "Could not load product catalog — growth opportunities suppressed",
      },
    ]);
  });

  it("collects a warn-severity record when invoices fails", async () => {
    const result = await run({ invoices: "fail" });
    expect(result.warnings).toEqual([
      {
        feed: "invoices",
        severity: "warn",
        message: "Could not load invoices — audit findings suppressed",
      },
    ]);
  });

  it("collects an error-severity record when subscriptions fails", async () => {
    // Subs are the primary feed — an "all quiet" render with a failed subs
    // fetch is the single most-misleading state, so the severity escalates
    // to error.
    const result = await run({ subs: "fail" });
    expect(result.warnings).toEqual([
      {
        feed: "subscriptions",
        severity: "error",
        message: "Could not load subscriptions — today's list is incomplete",
      },
    ]);
  });

  it("collects multiple warnings in the documented order when several feeds fail", async () => {
    const result = await run({
      companies: "fail",
      products: "fail",
      invoices: "fail",
      subs: "fail",
    });
    expect(result.warnings.map((w) => w.feed)).toEqual([
      "companies",
      "products",
      "invoices",
      "subscriptions",
    ]);
    expect(result.warnings.map((w) => w.severity)).toEqual([
      "warn",
      "warn",
      "warn",
      "error",
    ]);
  });
});
