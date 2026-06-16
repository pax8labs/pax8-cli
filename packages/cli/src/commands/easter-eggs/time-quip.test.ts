// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, afterEach, vi } from "vitest";
import { getTimeQuip } from "./time-quip.js";

/**
 * Coverage for `PAX8_DISABLE_QUIP` — the test-harness escape hatch
 * added for #620. The quip itself is intentionally time-and-day
 * dependent and we don't want to pin the exact text or schedule (that
 * would make it unhelpful for the developer making changes); the
 * contract this test pins is purely: when the env var is set, the
 * function returns null regardless of time.
 *
 * `runCli` in `__tests__/test-utils.ts` sets this env var
 * unconditionally so the rest of the suite never has to deal with
 * time-of-day stderr leaks. A test that wants to exercise the quip
 * itself can pass `PAX8_DISABLE_QUIP: ""` to override the harness.
 */
describe("getTimeQuip", () => {
  const originalEnv = process.env.PAX8_DISABLE_QUIP;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.PAX8_DISABLE_QUIP;
    else process.env.PAX8_DISABLE_QUIP = originalEnv;
    vi.useRealTimers();
  });

  describe("PAX8_DISABLE_QUIP bypass (#620)", () => {
    it("returns null when PAX8_DISABLE_QUIP=1, even at the witching hour", () => {
      // Force the wall clock to 3:10 AM local — the "go to bed" quip
      // window the original #620 variant fired in. Without the bypass,
      // getTimeQuip would return a non-null string here.
      vi.useFakeTimers();
      const witchingHour = new Date();
      witchingHour.setHours(3, 10, 0, 0);
      vi.setSystemTime(witchingHour);

      process.env.PAX8_DISABLE_QUIP = "1";
      expect(getTimeQuip()).toBeNull();
    });

    it("returns null when PAX8_DISABLE_QUIP=1, even on Friday evening", () => {
      // Friday after 4:30 PM local — another quip window.
      vi.useFakeTimers();
      // Pick a known Friday: Oct 24, 2025 is a Friday (irrelevant to
      // the test's correctness — only that getDay()===5).
      const friday = new Date("2025-10-24T17:00:00");
      vi.setSystemTime(friday);

      process.env.PAX8_DISABLE_QUIP = "1";
      expect(getTimeQuip()).toBeNull();
    });

    it("DOES return a quip when PAX8_DISABLE_QUIP is unset, in a quip window", () => {
      // Sanity check the other direction — without the env var, the
      // 3 AM window does emit a quip. If this ever fails, either the
      // bypass is too aggressive (intercepting unrelated unset state)
      // or the underlying time-window logic regressed.
      vi.useFakeTimers();
      const witchingHour = new Date();
      witchingHour.setHours(3, 10, 0, 0);
      vi.setSystemTime(witchingHour);

      delete process.env.PAX8_DISABLE_QUIP;
      expect(getTimeQuip()).not.toBeNull();
    });

    it("an explicit empty string does NOT trigger the bypass (only '1' counts)", () => {
      // The test harness exposes the same env var with `""` as the
      // documented opt-back-in shape (so a test that wants to
      // exercise the quip can override the suite default). Make sure
      // that path actually re-enables the quip — otherwise the test
      // harness's override contract is broken.
      vi.useFakeTimers();
      const witchingHour = new Date();
      witchingHour.setHours(3, 10, 0, 0);
      vi.setSystemTime(witchingHour);

      process.env.PAX8_DISABLE_QUIP = "";
      expect(getTimeQuip()).not.toBeNull();
    });
  });
});
