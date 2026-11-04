// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";

/**
 * Regression test for #620 Variant B — the orders-fixture file shared
 * state. The fix is `vitest.per-test-config-dir-setup.ts`, which
 * registers global beforeEach/afterEach hooks that give each `it` block
 * its own `PAX8_CONFIG_DIR` mkdtemp. Without this isolation, concurrent
 * tests that call `pax8 orders create` write to the same
 * `${PAX8_CONFIG_DIR}/demo-orders.json` and shift `totalElements` under
 * each other, producing the original #620 flake on coverage-Node22-Ubuntu.
 *
 * This test pins the contract from the test-side: every test gets a
 * different `PAX8_CONFIG_DIR` value. If the setupFile is removed or
 * regresses (e.g. the override-respect check breaks), the assertion
 * below fails loudly.
 *
 * We can't easily test the subprocess-spawn path here without exercising
 * the mock client; that's covered by the existing scale-regression tests
 * in `orders.test.ts` which rely on the dir being clean. The contract
 * we pin here is the building block.
 */
describe("per-test PAX8_CONFIG_DIR isolation (#620 Variant B)", () => {
  let firstTestConfigDir: string | undefined;

  it("test A captures the per-test PAX8_CONFIG_DIR", () => {
    firstTestConfigDir = process.env.PAX8_CONFIG_DIR;
    // It exists (globalSetup + setupFile both populate it).
    expect(firstTestConfigDir).toBeTruthy();
    // And it lives under the OS tmpdir — the setupFile's mkdtemp shape.
    expect(firstTestConfigDir).toMatch(/pax8-test-/);
  });

  it("test B sees a DIFFERENT PAX8_CONFIG_DIR from test A", () => {
    const secondTestConfigDir = process.env.PAX8_CONFIG_DIR;
    expect(secondTestConfigDir).toBeTruthy();
    expect(secondTestConfigDir).toMatch(/pax8-test-/);
    // The core contract: two tests in the same file see distinct dirs.
    // Pre-fix this would have been `expect(...).toBe(firstTestConfigDir)`
    // because PAX8_CONFIG_DIR was set once per workers spawn.
    expect(secondTestConfigDir).not.toBe(firstTestConfigDir);
  });

  describe("a nested describe block also gets fresh dirs per test", () => {
    let nestedDir: string | undefined;

    it("nested test 1", () => {
      nestedDir = process.env.PAX8_CONFIG_DIR;
      expect(nestedDir).toBeTruthy();
    });

    it("nested test 2 is also different", () => {
      const otherNestedDir = process.env.PAX8_CONFIG_DIR;
      expect(otherNestedDir).not.toBe(nestedDir);
    });
  });
});
