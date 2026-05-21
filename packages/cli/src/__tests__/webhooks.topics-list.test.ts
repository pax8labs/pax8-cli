// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess } from "./test-utils.js";

describe("pax8 webhooks topics list", () => {
  it("returns topic definitions in JSON", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--json",
    ]);
    // #483: JSON envelope is { topics, page } (single-page envelope —
    // the topic-definitions endpoint isn't paginated).
    const data = JSON.parse(result.stdout);
    expect(data).toHaveProperty("topics");
    expect(data).toHaveProperty("page");
    expect(Array.isArray(data.topics)).toBe(true);
    expect(data.topics.length).toBeGreaterThan(0);
    expect(data.topics[0]).toHaveProperty("topic");
    expect(data.topics[0]).toHaveProperty("description");
    expect(data.topics[0]).toHaveProperty("name");
  });

  it("returns topics sorted alphabetically by slug", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout) as { topics: { topic: string }[] };
    const slugs = data.topics.map((t) => t.topic);
    const sorted = [...slugs].sort((a, b) => a.localeCompare(b));
    expect(slugs).toEqual(sorted);
  });

  it("includes the seeded demo topics", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--json",
    ]);
    const data = JSON.parse(result.stdout) as { topics: { topic: string }[] };
    const slugs = data.topics.map((t) => t.topic);
    expect(slugs).toContain("subscription.created");
    expect(slugs).toContain("invoice.paid");
    expect(slugs).toContain("order.created");
  });

  it("supports --ids-only for pipelines", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--ids-only",
    ]);
    const lines = result.stdout.trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    // Each line should be a single topic slug (no whitespace, no JSON braces)
    for (const line of lines) {
      expect(line).not.toContain("{");
      expect(line).not.toContain(" ");
    }
  });

  it("emits an envelope with nextActions under --with-actions", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--with-actions",
      "--json",
    ]);
    const data = JSON.parse(result.stdout);
    expect(Array.isArray(data)).toBe(false);
    expect(data).toHaveProperty("topics");
    expect(Array.isArray(data.topics)).toBe(true);
    expect(data).toHaveProperty("nextActions");
    expect(Array.isArray(data.nextActions)).toBe(true);
  });

  it("shows examples in help text", async () => {
    const result = await runCliExpectSuccess([
      "webhooks",
      "topics",
      "list",
      "--help",
    ]);
    expect(result.stdout).toContain("Examples:");
    expect(result.stdout).toContain("--json");
  });

  it("registers the `topics` group on the webhooks command", async () => {
    const result = await runCliExpectSuccess(["webhooks", "--help"]);
    expect(result.stdout).toContain("topics");
  });
});
