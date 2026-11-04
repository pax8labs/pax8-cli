// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("E2E: Subscription management — daily workflows", () => {
  it("pax8 subscriptions list shows subscriptions", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "list"]);
    expect(result.stdout.length).toBeGreaterThan(0);
    // #483: wrapped envelope { subscriptions, page }.
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(data.subscriptions.length).toBeGreaterThan(0);
  });

  it("pax8 subscriptions list --json produces valid JSON", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data.subscriptions)).toBe(true);
    expect(data.subscriptions.length).toBeGreaterThan(0);
    expect(data.subscriptions[0]).toHaveProperty("id");
    expect(data.subscriptions[0]).toHaveProperty("productName");
    expect(data.subscriptions[0]).toHaveProperty("status");
    expect(data.subscriptions[0]).toHaveProperty("quantity");
  });

  it("pax8 subscriptions renewals shows renewal report", async () => {
    const result = await runCliExpectSuccess(["subscriptions", "renewals"]);
    expect(result.stdout.length).toBeGreaterThan(0);
  });

  it("pax8 subscriptions renewals --within 7d shows filtered renewals", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--within",
      "7d",
    ]);
    // Should succeed even if no renewals within 7 days
    expect(result.exitCode).toBe(0);
  });

  it("pax8 subscriptions renewals --json emits { renewals, page } envelope (#483)", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(data).toHaveProperty("page");
    expect(Array.isArray(data.renewals)).toBe(true);
    if (data.renewals.length > 0) {
      expect(data.renewals[0]).toHaveProperty("subscriptionId");
      expect(data.renewals[0]).toHaveProperty("renewalDate");
      // Canonical name introduced in #298 — temporal "renewing in window"
      // rather than "at risk" (which silently conflated with Pax8's
      // patent-filed Revenue at Risk Predictor ML model). The legacy
      // `mrrAtRisk` alias was dropped in #476 pre-launch.
      expect(data.renewals[0]).toHaveProperty("mrrRenewing");
      expect(data.renewals[0]).not.toHaveProperty("mrrAtRisk");
      expect(data.renewals[0]).toHaveProperty("daysUntilRenewal");
    }
  });

  it("pax8 subscriptions renewals --json --with-actions adds nextActions to envelope", async () => {
    const result = await runCliExpectSuccess([
      "subscriptions",
      "renewals",
      "--json",
      "--with-actions",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("renewals");
    expect(data).toHaveProperty("page");
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.renewals)).toBe(true);
    expect(Array.isArray(data.nextActions)).toBe(true);
  });
});
