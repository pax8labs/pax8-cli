// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { buildCacheKey } from "./client.js";

// Regression coverage for #455: the cache key MUST be partitioned by tenant
// identity (`PAX8_CLIENT_ID`) and base URL (`PAX8_API_BASE`). Otherwise a
// user who switches credentials — or flips between prod / staging / sandbox
// — is silently served the previous identity's responses for up to 24h.

describe("buildCacheKey (#455)", () => {
  it("produces a stable key when nothing changes", () => {
    const a = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-a",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    const b = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-a",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    expect(a).toBe(b);
  });

  it("differs when PAX8_CLIENT_ID changes (cross-tenant)", () => {
    const tenantA = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-a",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    const tenantB = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-b",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    expect(tenantA).not.toBe(tenantB);
  });

  it("differs when PAX8_API_BASE changes (prod vs staging)", () => {
    const prod = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-a",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    const staging = buildCacheKey({
      path: "/companies",
      params: { size: 50 },
      clientId: "tenant-a",
      apiBaseEnv: "https://api-staging.pax8.com/v1",
      baseUrl: "https://api-staging.pax8.com/v1",
    });
    expect(prod).not.toBe(staging);
  });

  it("differs when both PAX8_CLIENT_ID and PAX8_API_BASE change", () => {
    const a = buildCacheKey({
      path: "/companies",
      clientId: "tenant-a",
      apiBaseEnv: "https://api.pax8.com/v1",
      baseUrl: "https://api.pax8.com/v1",
    });
    const b = buildCacheKey({
      path: "/companies",
      clientId: "tenant-b",
      apiBaseEnv: "https://api-staging.pax8.com/v1",
      baseUrl: "https://api-staging.pax8.com/v1",
    });
    expect(a).not.toBe(b);
  });

  it("falls back to a tenant-less key when no identity inputs are supplied", () => {
    // Backwards-compatible behavior for embedders that don't pass identity
    // information. The key still includes path + params so it's still useful
    // for in-process caching; just not safe across credential rotations.
    const key = buildCacheKey({ path: "/companies", params: { size: 50 } });
    expect(key).toBe("companies_size=50");
  });

  it("preserves api + apiVersion prefixes (#321/#307)", () => {
    const v1 = buildCacheKey({
      path: "/foo",
      clientId: "tenant-a",
      baseUrl: "https://api.pax8.com/v1",
    });
    const v2 = buildCacheKey({
      path: "/foo",
      apiVersion: "v2",
      clientId: "tenant-a",
      baseUrl: "https://api.pax8.com/v1",
    });
    const webhooks = buildCacheKey({
      path: "/foo",
      api: "webhooks",
      clientId: "tenant-a",
      baseUrl: "https://api.pax8.com/v1",
    });
    expect(v1).not.toBe(v2);
    expect(v1).not.toBe(webhooks);
    expect(v2).not.toBe(webhooks);
  });

  it("query-string params are key-order independent", () => {
    const a = buildCacheKey({
      path: "/companies",
      params: { size: 50, page: 0 },
      clientId: "tenant-a",
      baseUrl: "https://api.pax8.com/v1",
    });
    const b = buildCacheKey({
      path: "/companies",
      params: { page: 0, size: 50 },
      clientId: "tenant-a",
      baseUrl: "https://api.pax8.com/v1",
    });
    expect(a).toBe(b);
  });
});
