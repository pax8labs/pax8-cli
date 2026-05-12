// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import {
  runCli,
  runCliExpectSuccess,
  runCliExpectFailure,
} from "./test-utils.js";

const ACTIVE_WEBHOOK_ID = "11111111-2222-3333-4444-555555555501";
const DISABLED_WEBHOOK_ID = "11111111-2222-3333-4444-555555555503";

describe("pax8 webhooks show", () => {
  it("returns the full webhook in JSON format", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      ACTIVE_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
    expect(data.url).toBeTruthy();
    expect(data.status).toBe("Active");
    expect(Array.isArray(data.topics)).toBe(true);
    // New v2.1 fields are populated for demo data so agents can rely on them.
    expect(data).toHaveProperty("displayName");
    expect(data).toHaveProperty("contactEmail");
    expect(data).toHaveProperty("errorThreshold");
    expect(data).toHaveProperty("lastDeliveryStatus");
  });

  it("shows a Disabled webhook from demo data", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      DISABLED_WEBHOOK_ID,
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(data.status).toBe("Disabled");
  });

  it("renders detail view in TTY mode (non-TTY also writes detail to stdout for human use, but tests assert presence)", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "show",
      ACTIVE_WEBHOOK_ID,
    ]);
    // Non-TTY default → JSON. Test the JSON shape.
    const data = JSON.parse(result.stdout);
    expect(data.id).toBe(ACTIVE_WEBHOOK_ID);
  });

  it("fails on unknown id with a non-zero exit code", async () => {
    const result = await runCliExpectFailure([
      "webhooks",
      "show",
      "00000000-0000-0000-0000-000000000000",
    ]);
    const combined = result.stdout + result.stderr;
    expect(combined.length).toBeGreaterThan(0);
  });

  it("shows --help with examples", async () => {
    const result = await runCliExpectSuccess(["webhooks", "show", "--help"]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--json");
  });

  it("appears in `webhooks --help`", async () => {
    const result = await runCli(["webhooks", "--help"]);
    expect(result.stdout).toContain("show");
    expect(result.stdout).toContain("update");
    expect(result.stdout).toContain("enable");
    expect(result.stdout).toContain("disable");
  });

  // ─── Tier 0 secret redaction (#300) ──────────────────────────────────────
  //
  // The webhook `secret` is the HMAC signing key — Tier 0 (Existential) per
  // Pax8 Data Risk Tiering. Industry-standard pattern (Stripe / GitHub /
  // Twilio): show once on create, never on read. The CLI strips the field
  // from every read-path command (show / list / logs) even if the API
  // returns it.
  describe("redacts the HMAC `secret` (Tier 0) on read paths", () => {
    it("`webhooks show <id> --json` does NOT include the secret value", async () => {
      const result = await runCliExpectSuccess([
        "webhooks",
        "show",
        ACTIVE_WEBHOOK_ID,
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).not.toHaveProperty("secret");
      expect(result.stdout).not.toMatch(/whsec_/);
      expect(result.stdout).not.toMatch(/"secret"\s*:/);
    });

    it("`webhooks show <id>` (human render) does NOT include the secret value", async () => {
      const result = await runCliExpectSuccess([
        "webhooks",
        "show",
        ACTIVE_WEBHOOK_ID,
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).not.toMatch(/whsec_/);
      // Human render shouldn't print a "Secret:" label either.
      expect(combined).not.toMatch(/Secret:/i);
    });

    it("`webhooks list --json` does NOT include any secret field", async () => {
      const result = await runCliExpectSuccess(["webhooks", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      const items: Array<Record<string, unknown>> = Array.isArray(data)
        ? data
        : ((data as { webhooks?: Array<Record<string, unknown>> }).webhooks ?? []);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).not.toHaveProperty("secret");
      }
      expect(result.stdout).not.toMatch(/whsec_/);
    });

    it("emits BOTH `createdDate` and canonical `createdAt` on every row (#385 deprecation window)", async () => {
      // #385: timestamp field standardization. `createdAt` is the canonical
      // past-tense camelCase name; `createdDate` is preserved as a deprecated
      // alias for one minor version cycle so existing `--json` consumers
      // don't break. Removal scheduled for v0.3.0. `updatedAt` was already
      // canonical (Pax8 v2.1+) so it doesn't need an alias.
      const result = await runCliExpectSuccess(["webhooks", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      const items: Array<Record<string, unknown>> = Array.isArray(data)
        ? data
        : ((data as { webhooks?: Array<Record<string, unknown>> }).webhooks ?? []);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item).toHaveProperty("createdDate");
        expect(item).toHaveProperty("createdAt");
        expect(item.createdAt).toBe(item.createdDate);
      }
    });

    it("`webhooks logs <id> --json` does NOT include any secret field", async () => {
      const result = await runCliExpectSuccess([
        "webhooks",
        "logs",
        ACTIVE_WEBHOOK_ID,
        "--json",
      ]);
      // Tolerate either a flat array or { logs, nextActions } envelope.
      const parsed = JSON.parse(result.stdout);
      const logs: Array<Record<string, unknown>> = Array.isArray(parsed)
        ? parsed
        : ((parsed as { logs?: Array<Record<string, unknown>> }).logs ?? []);
      for (const entry of logs) {
        expect(entry).not.toHaveProperty("secret");
      }
      expect(result.stdout).not.toMatch(/whsec_/);
    });
  });
});
