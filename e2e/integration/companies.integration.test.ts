// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Seed v1 smoke test (#308). Proves the default `/v1` routing reaches the
 * real Pax8 partner API and returns a parseable response. See `harness.ts`
 * for the extension pattern.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
  expectWireUrl,
} from "./harness.js";

describeIntegration("companies (v1)", () => {
  it(
    "companies list --json hits /v1/companies and returns an array",
    async () => {
      const result = await runCliVerbose(["companies", "list", "--json"]);

      expectExitZero(result);
      expectWireUrl(result, {
        method: "GET",
        pathContains: "/v1/companies",
        version: "v1",
      });

      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      // Most real partner tenants have at least one company. Don't assert
      // length > 0 — an empty-portfolio sandbox is still a valid v1 read.
    },
    60_000,
  );
});
