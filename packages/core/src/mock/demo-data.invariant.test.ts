// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Drift insurance for the demo fixtures.
 *
 * The mock client returns objects from `demo-data.ts` directly — it doesn't
 * Zod-parse them on the way out. If a public schema in `api/types.ts` adds a
 * required field or tightens a type, the demo data silently goes stale (we
 * hit this on PR #277 when the demo `Company` type didn't reflect a schema
 * change). This test parses every demo entry against its public schema so any
 * such drift fails CI immediately.
 *
 * Invariant: every entry in every demo collection that has a public Zod schema
 * MUST `safeParse` cleanly. If a collection has no corresponding schema (e.g.
 * internal helper data), it's skipped explicitly with a comment.
 *
 * NOTE — known-incomplete coverage:
 * Only the four collections covered below (`companies`, `webhooks`,
 * `webhookLogs`, `webhookTopicDefinitions`) parse against their public
 * schemas today. The remaining demo collections — `subscriptions`, `products`,
 * `invoices`, `invoiceItems`, `orders`, `contacts`, `usageSummaries`,
 * `usageLines`, `quotes` — fail because every demo seed uses
 * human-readable IDs (e.g. `prod-m365-...`, `sub-summit-...`, `inv-summit-...`)
 * while the schemas declare `id: z.string().uuid()` (and similarly on every
 * cross-reference: `productId`, `companyId`, etc.). The two surfaces were
 * never reconciled because the mock client bypasses Zod on read paths, so
 * the conflict was invisible until this invariant was attempted.
 *
 * Resolving it is a design call (loosen the schemas to `z.string()` on IDs to
 * match the upstream OpenAPI spec, OR migrate demo IDs to UUIDs and keep
 * readable names in the existing `*Name` fields). That's a separate PR; this
 * file ships only what passes today and grows as the conflict is resolved.
 */

import { describe, it, expect } from "vitest";
import type { z } from "zod";
import {
  CompanySchema,
  TopicDefinitionSchema,
  WebhookLogSchema,
  WebhookSchema,
} from "../api/types.js";
import {
  companies,
  webhookLogs,
  webhookTopicDefinitions,
  webhooks,
} from "./demo-data.js";

/**
 * Walk every entry in `collection`, Zod-parse it, and assert success. On
 * failure, surface the entry index, its `id` if any, and the Zod error paths
 * so the diagnostic isn't a wall of stringified noise.
 */
function expectAllParse<T>(
  collection: readonly T[],
  schema: z.ZodTypeAny,
  collectionName: string,
): void {
  const failures: string[] = [];
  for (let i = 0; i < collection.length; i++) {
    const entry = collection[i];
    const result = schema.safeParse(entry);
    if (!result.success) {
      const id =
        entry && typeof entry === "object" && "id" in entry
          ? String((entry as { id: unknown }).id)
          : `<index ${i}>`;
      const issues = result.error.issues
        .map((iss) => `    - ${iss.path.join(".") || "<root>"}: ${iss.message}`)
        .join("\n");
      failures.push(`  [${i}] ${id}:\n${issues}`);
    }
  }
  expect(
    failures,
    `${collectionName}: ${failures.length}/${collection.length} entries failed Zod validation:\n${failures.join("\n")}`,
  ).toEqual([]);
}

describe("demo-data — Zod schema invariant", () => {
  it("companies parse against CompanySchema", () => {
    expectAllParse(companies, CompanySchema, "companies");
  });

  it("webhooks parse against WebhookSchema", () => {
    expectAllParse(webhooks, WebhookSchema, "webhooks");
  });

  it("webhookLogs parse against WebhookLogSchema", () => {
    expectAllParse(webhookLogs, WebhookLogSchema, "webhookLogs");
  });

  it("webhookTopicDefinitions parse against TopicDefinitionSchema", () => {
    expectAllParse(
      webhookTopicDefinitions,
      TopicDefinitionSchema,
      "webhookTopicDefinitions",
    );
  });
});
