// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getUserAgent, setUserAgentProduct, resetUserAgentProduct } from "./user-agent.js";
import { Pax8Client } from "./client.js";
import { TokenManager } from "../auth/token-manager.js";

describe("User-Agent", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => resetUserAgentProduct());
  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetUserAgentProduct();
  });

  it("identifies the core library and runtime by default", () => {
    expect(getUserAgent()).toBe(`pax8labs-core node/${process.versions.node} (${process.platform})`);
  });

  it("leads with the embedding product once set", () => {
    setUserAgentProduct("pax8labs-cli/0.4.0");
    expect(getUserAgent()).toMatch(/^pax8labs-cli\/0\.4\.0 pax8labs-core node\//);
  });

  it("never uses the bare pax8-cli token a third-party tool already sends", () => {
    setUserAgentProduct("pax8labs-cli/0.4.0");
    expect(getUserAgent()).not.toMatch(/(^|\s)pax8-cli\//);
  });

  it.each(["has space/1.0", "", "a/b/c", "bad\r\nheader/1"])("ignores an invalid product %j", (value) => {
    setUserAgentProduct(value);
    expect(getUserAgent()).toMatch(/^pax8labs-core /);
  });

  it("is sent on API requests", async () => {
    setUserAgentProduct("pax8labs-cli/9.9.9");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers(),
      json: () => Promise.resolve({}),
    });
    const client = new Pax8Client({
      tokenManager: { getToken: async () => "t", clearCache: () => {} } as never,
      cacheTtlMs: 0,
    });
    await client.get("/companies");
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["User-Agent"]).toMatch(/^pax8labs-cli\/9\.9\.9 /);
  });

  it("is sent on the OAuth token exchange", async () => {
    setUserAgentProduct("pax8labs-cli/9.9.9");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ access_token: "a", expires_in: 3600, token_type: "Bearer" }),
    });
    const tm = new TokenManager({
      clientId: "id",
      clientSecret: "secret",
      cacheStore: { load: () => null, save: () => {}, clear: () => {} } as never,
    });
    await tm.getToken();
    const [, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers["User-Agent"]).toMatch(/^pax8labs-cli\/9\.9\.9 /);
  });
});
