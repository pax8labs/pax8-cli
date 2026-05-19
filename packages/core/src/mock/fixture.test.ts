// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// Selector test for the fixture module (#484).
//
// Verifies that `PAX8_DEMO_SCALE=large` swaps the entity arrays for the
// generated fixture while the default selection leaves the small fixture
// untouched. We can't fully test the env switch via vitest's module cache
// without `vi.resetModules`, so we go straight to the underlying primitives
// and assert that:
//   1. The small fixture has the curated hand-coded count (sanity).
//   2. The large fixture generator produces a strict superset of that
//      count (so we know the swap, when it happens, expands the surface).

import { describe, it, expect } from "vitest";
import * as smallFixture from "./demo-data.js";
import { buildLargeFixture } from "./large-fixture.js";

describe("fixture selector", () => {
  it("the small (default) fixture is the hand-curated demo set", () => {
    // Lightly-coupled sanity: the hand-curated fixture has dozens of
    // companies, not thousands. If this assertion ever fails, someone
    // expanded the small fixture beyond its intended scope — review.
    expect(smallFixture.companies.length).toBeGreaterThan(0);
    expect(smallFixture.companies.length).toBeLessThan(100);
  });

  it("the large fixture is strictly bigger across every populated entity", () => {
    const large = buildLargeFixture();
    expect(large.companies.length).toBeGreaterThan(smallFixture.companies.length * 10);
    expect(large.subscriptions.length).toBeGreaterThan(smallFixture.subscriptions.length * 10);
    expect(large.orders.length).toBeGreaterThan(smallFixture.orders.length * 10);
    expect(large.products.length).toBeGreaterThan(smallFixture.products.length);
  });

  it("the large fixture reuses webhookTopicDefinitions from the small fixture (global catalog)", () => {
    const large = buildLargeFixture();
    expect(large.webhookTopicDefinitions).toBe(smallFixture.webhookTopicDefinitions);
  });
});
