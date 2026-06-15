// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi } from "vitest";
import type { Subscription, PaginatedResponse } from "@pax8/core";
import type { Ora } from "ora";
import { collectAllSubscriptions, collectSubsWithSpinner } from "./subs-stream.js";

/**
 * Direct unit coverage for `subs-stream.ts`, the pagination + spinner
 * contract that backs every aggregator command after #629 (~11 callers:
 * dashboard, invoices audit/dispute, recommendations list/upsell/act,
 * report subscriptions/renewals/concentration, subscriptions renewals,
 * cost sim, clients list with coverage). A regression here — dropped
 * page, wrong totalElements on the spinner, broken >1000 threshold —
 * would silently re-introduce #613's silent-truncation class across
 * every consumer at once.
 *
 * Tests use a fake `AsyncIterableIterator<PaginatedResponse<Subscription>>`
 * so they don't pull in the real `Pax8Client` / `MockPax8Client`. The
 * lib's job is only to materialize pages and call back; what produces
 * the pages is irrelevant.
 */

function sub(id: string): Subscription {
  // Cast through unknown because Subscription's full schema has more
  // required fields than the lib actually touches. We only need an id
  // for assertions.
  return { id } as unknown as Subscription;
}

function pageEnvelope(
  content: Subscription[],
  opts: { number: number; totalPages: number; totalElements: number },
): PaginatedResponse<Subscription> {
  return {
    content,
    page: {
      size: 1000,
      number: opts.number,
      totalPages: opts.totalPages,
      totalElements: opts.totalElements,
    },
  };
}

async function* fromPages(
  pages: PaginatedResponse<Subscription>[],
): AsyncIterableIterator<PaginatedResponse<Subscription>> {
  for (const p of pages) yield p;
}

/**
 * Build a minimal Ora-shaped object that records every text assignment.
 * `text` is a real setter; the rest are no-ops good enough to satisfy
 * the helper's call shape (which only writes to `.text`).
 */
function fakeSpinner() {
  const writes: string[] = [];
  const spinner = {
    _text: "",
    get text() {
      return this._text;
    },
    set text(value: string) {
      this._text = value;
      writes.push(value);
    },
    start: () => spinner,
    stop: () => spinner,
    succeed: () => spinner,
    fail: () => spinner,
    info: () => spinner,
    warn: () => spinner,
  } as unknown as Ora & { _text: string };
  return { spinner, writes };
}

describe("collectAllSubscriptions", () => {
  it("returns an empty array when the stream yields zero pages", async () => {
    const result = await collectAllSubscriptions(fromPages([]));
    expect(result).toEqual([]);
  });

  it("returns the content of a single-page stream as a flat array", async () => {
    const result = await collectAllSubscriptions(
      fromPages([
        pageEnvelope([sub("a"), sub("b"), sub("c")], {
          number: 0,
          totalPages: 1,
          totalElements: 3,
        }),
      ]),
    );
    expect(result.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("concatenates pages in order across multi-page streams", async () => {
    const result = await collectAllSubscriptions(
      fromPages([
        pageEnvelope([sub("p0-1"), sub("p0-2")], {
          number: 0,
          totalPages: 3,
          totalElements: 5,
        }),
        pageEnvelope([sub("p1-1"), sub("p1-2")], {
          number: 1,
          totalPages: 3,
          totalElements: 5,
        }),
        pageEnvelope([sub("p2-1")], {
          number: 2,
          totalPages: 3,
          totalElements: 5,
        }),
      ]),
    );
    expect(result.map((s) => s.id)).toEqual(["p0-1", "p0-2", "p1-1", "p1-2", "p2-1"]);
  });

  it("calls onProgress after each page with running total + page.totalElements", async () => {
    const onProgress = vi.fn<(loaded: number, total: number) => void>();
    await collectAllSubscriptions(
      fromPages([
        pageEnvelope([sub("a"), sub("b")], {
          number: 0,
          totalPages: 2,
          totalElements: 3,
        }),
        pageEnvelope([sub("c")], {
          number: 1,
          totalPages: 2,
          totalElements: 3,
        }),
      ]),
      onProgress,
    );
    expect(onProgress).toHaveBeenCalledTimes(2);
    // Running total grows with each page; total stays stable across pages.
    expect(onProgress).toHaveBeenNthCalledWith(1, 2, 3);
    expect(onProgress).toHaveBeenNthCalledWith(2, 3, 3);
  });

  it("does not invoke onProgress when the stream is empty", async () => {
    const onProgress = vi.fn<(loaded: number, total: number) => void>();
    await collectAllSubscriptions(fromPages([]), onProgress);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("propagates errors from the source stream without partial results", async () => {
    async function* erroring(): AsyncIterableIterator<PaginatedResponse<Subscription>> {
      yield pageEnvelope([sub("a")], { number: 0, totalPages: 2, totalElements: 2 });
      throw new Error("source page-2 fetch failed");
    }
    await expect(collectAllSubscriptions(erroring())).rejects.toThrow(
      "source page-2 fetch failed",
    );
  });
});

describe("collectSubsWithSpinner", () => {
  it("returns the full materialized array (delegates to collectAllSubscriptions)", async () => {
    const { spinner } = fakeSpinner();
    const result = await collectSubsWithSpinner(
      fromPages([
        pageEnvelope([sub("a"), sub("b")], {
          number: 0,
          totalPages: 1,
          totalElements: 2,
        }),
      ]),
      spinner,
      "test",
    );
    expect(result.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("does NOT update spinner text when total <= 1000 (small-portfolio anti-flicker)", async () => {
    const { spinner, writes } = fakeSpinner();
    // 500 subs, single page, totalElements 500 — well under the threshold.
    await collectSubsWithSpinner(
      fromPages([
        pageEnvelope(
          Array.from({ length: 500 }, (_, i) => sub(`s${i}`)),
          { number: 0, totalPages: 1, totalElements: 500 },
        ),
      ]),
      spinner,
      "dashboard",
    );
    expect(writes).toEqual([]);
  });

  it("does NOT update spinner text at exactly total === 1000 (boundary — small enough not to flicker)", async () => {
    const { spinner, writes } = fakeSpinner();
    await collectSubsWithSpinner(
      fromPages([
        pageEnvelope(
          Array.from({ length: 1000 }, (_, i) => sub(`s${i}`)),
          { number: 0, totalPages: 1, totalElements: 1000 },
        ),
      ]),
      spinner,
      "dashboard",
    );
    expect(writes).toEqual([]);
  });

  it("updates spinner text on every page when total > 1000, naming label + running tally + total", async () => {
    const { spinner, writes } = fakeSpinner();
    // Three-page portfolio: 1000 + 1000 + 500 = 2500 totalElements.
    await collectSubsWithSpinner(
      fromPages([
        pageEnvelope(
          Array.from({ length: 1000 }, (_, i) => sub(`p0-${i}`)),
          { number: 0, totalPages: 3, totalElements: 2500 },
        ),
        pageEnvelope(
          Array.from({ length: 1000 }, (_, i) => sub(`p1-${i}`)),
          { number: 1, totalPages: 3, totalElements: 2500 },
        ),
        pageEnvelope(
          Array.from({ length: 500 }, (_, i) => sub(`p2-${i}`)),
          { number: 2, totalPages: 3, totalElements: 2500 },
        ),
      ]),
      spinner,
      "dashboard",
    );
    expect(writes).toEqual([
      "Loading dashboard... (1,000 of 2,500 subscriptions)",
      "Loading dashboard... (2,000 of 2,500 subscriptions)",
      "Loading dashboard... (2,500 of 2,500 subscriptions)",
    ]);
  });

  it("honors the custom label passed by each caller", async () => {
    const { spinner, writes } = fakeSpinner();
    await collectSubsWithSpinner(
      fromPages([
        pageEnvelope(
          Array.from({ length: 1500 }, (_, i) => sub(`s${i}`)),
          { number: 0, totalPages: 1, totalElements: 1500 },
        ),
      ]),
      spinner,
      "invoice audit",
    );
    expect(writes).toEqual([
      "Loading invoice audit... (1,500 of 1,500 subscriptions)",
    ]);
  });

  it("formats large numbers with locale separators (5-digit+ portfolios still readable)", async () => {
    const { spinner, writes } = fakeSpinner();
    // 12,000 total — the kind of number where digit-grouping matters.
    await collectSubsWithSpinner(
      fromPages([
        pageEnvelope(
          Array.from({ length: 1000 }, (_, i) => sub(`s${i}`)),
          { number: 0, totalPages: 12, totalElements: 12000 },
        ),
      ]),
      spinner,
      "report",
    );
    expect(writes[0]).toMatch(/1,000 of 12,000/);
  });
});
