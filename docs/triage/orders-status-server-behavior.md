# Orders status filter — server-side honor test

**Status:** Test gated by missing sandbox credentials. Requires maintainer with `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` configured to execute.

**Question:** PR #360 added a disclaimer that `pax8 orders list --status` is not in the public OpenAPI spec. Does the Pax8 server actually honor the filter, or is it ignored client-side?

**Impact:** If the server honors the filter, the disclaimer is misleading and should be softened to flag the spec gap (server accepts it but docs don't expose it). If the server silently ignores it, the current disclaimer is accurate.

---

## 1. Current CLI behavior

**File:** `packages/cli/src/commands/orders/list.ts:56–58`

```ts
if (allOpts.status) {
  params.status = allOpts.status;
}
```

The `--status` flag is passed directly to the API as a query parameter:

**File:** `packages/core/src/api/orders.ts:18–26`

```ts
async list(params?: {
  page?: number;
  size?: number;
  companyId?: string;
  status?: string;
}): Promise<PaginatedResponse<Order>> {
  const raw = await this.client.get<unknown>("/orders", params as Record<string, string | number | undefined>);
  return PaginatedOrderSchema.parse(raw);
}
```

The `params` object is passed to `client.get()` as query-string parameters — **no client-side filtering occurs.** The `status` parameter is forwarded unmodified to `GET /orders?status=<value>`.

---

## 2. Spec posture

**Source:** PR #360 description and audit file (`eea4409:docs/triage/api-version-audit/orders-status-enum.md`)

The public Pax8 OpenAPI (`partner-endpoints.json`) declares:

- **`paths."/orders".get`** — Query parameters limited to pagination and `companyId`. **No `status` parameter.**
- **`components.schemas.Order`** — Fields: `id, companyId, createdDate, isScheduled, lineItems, orderedBy, orderedByUserEmail, orderedByUserId`. **No `status` field.**

**Help text:** `packages/cli/src/commands/orders/list.ts:26` (post-#360)

```ts
.option("--status <status>", "Filter by status (Completed, Processing, Failed, PendingManual)")
```

The help text was rewritten in #360 to flag the spec gap. The comment block above the option reads:

```ts
// Honesty note (#250): the public Pax8 OpenAPI does NOT document a `status`
// field on `Order` nor a `status` query parameter on `GET /orders`. The
// values below are observed in real API responses (and mirrored by the demo
// fixtures) but are NOT part of the published contract — they may change
// without notice. The flag is kept so partner scripts that already use it
// don't break; see docs/triage/api-version-audit/orders-status-enum.md.
```

---

## 3. Proposed sandbox test code

The test follows the harness pattern from `e2e/integration/companies.integration.test.ts` and uses the credential-gate pattern from `e2e/integration/harness.ts`.

**File location (proposed):** `e2e/integration/orders-status-filter.integration.test.ts`

```typescript
// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Orders status filter — server-side honor test (#360 follow-up).
 *
 * Verifies whether `pax8 orders list --status <X>` filters on the server side.
 * If the server honors the status parameter, the result set should differ from
 * the unfiltered baseline. If the server ignores it, counts match.
 *
 * This test is gated on sandbox credentials (PAX8_CLIENT_ID / PAX8_CLIENT_SECRET)
 * and is skipped when they are absent, per the harness pattern in #308.
 */

import { it, expect } from "vitest";
import {
  describeIntegration,
  runCliVerbose,
  expectExitZero,
} from "./harness.js";

describeIntegration("orders list --status filter (v1)", () => {
  it(
    "should filter results when --status is passed, if server honors it",
    async () => {
      // Step 1: Get the unfiltered baseline
      const baselineResult = await runCliVerbose([
        "orders",
        "list",
        "--json",
      ]);
      expectExitZero(baselineResult);

      const baselineData = JSON.parse(baselineResult.stdout);
      const baselineOrders = Array.isArray(baselineData) ? baselineData : baselineData.content || [];
      const baselineCount = baselineOrders.length;

      if (baselineCount === 0) {
        // If no orders exist in the sandbox, the test is inconclusive.
        // Document this clearly and skip the filter assertion.
        console.log(
          "[orders-status-filter] Sandbox has no orders; filter test is inconclusive"
        );
        expect(baselineCount).toBe(0);
        return;
      }

      // Step 2: Collect statuses present in the baseline
      const statusSet = new Set<string>();
      for (const order of baselineOrders) {
        if (order.status) {
          statusSet.add(String(order.status));
        }
      }

      if (statusSet.size === 0) {
        // No orders have a status field in the response. This means either:
        // (a) the server does not return status at all (spec is correct, no field)
        // (b) status is always null/undefined in the current sandbox data
        console.log(
          "[orders-status-filter] No status values found in baseline; cannot test filter"
        );
        expect(statusSet.size).toBe(0);
        return;
      }

      // Step 3: Test filtering by the first two distinct statuses
      const statuses = Array.from(statusSet).slice(0, 2);

      for (const status of statuses) {
        const filteredResult = await runCliVerbose([
          "orders",
          "list",
          "--status",
          status,
          "--json",
        ]);
        expectExitZero(filteredResult);

        const filteredData = JSON.parse(filteredResult.stdout);
        const filteredOrders = Array.isArray(filteredData) ? filteredData : filteredData.content || [];
        const filteredCount = filteredOrders.length;

        // Log the observation for the report
        console.log(
          `[orders-status-filter] status="${status}" => ${filteredCount} orders (baseline: ${baselineCount})`
        );

        // Step 4: Assert whether filtering occurred
        // If server honors the filter:
        //   - filtered count <= baseline count (usually strict <)
        //   - all filtered orders have status === <filter value>
        // If server ignores the filter:
        //   - filtered count === baseline count
        //   - orders in filtered result may have any status (same as baseline)

        // Non-strict assertion: if counts differ, the server appears to honor the filter.
        // If counts are equal, the server may be ignoring the filter (or baseline == filtered by coincidence).
        if (filteredCount < baselineCount) {
          console.log(
            `[orders-status-filter] FILTER HONORED: count reduced from ${baselineCount} to ${filteredCount}`
          );
          // Verify that all returned orders match the filter
          for (const order of filteredOrders) {
            expect(order.status).toBe(status);
          }
        } else if (filteredCount === baselineCount) {
          console.log(
            `[orders-status-filter] FILTER POSSIBLY IGNORED: count unchanged at ${baselineCount}`
          );
          // Count unchanged; either all baseline orders match this status,
          // or the server is ignoring the filter. Check the status values
          // in the filtered result to distinguish.
          const mismatchCount = filteredOrders.filter(
            (o) => o.status !== status
          ).length;
          if (mismatchCount > 0) {
            console.log(
              `[orders-status-filter] WARNING: filtered result contains ${mismatchCount} orders with status !== "${status}" — server may be ignoring the filter`
            );
          } else {
            console.log(
              `[orders-status-filter] All returned orders match the filter (count unchanged because all baseline orders share this status)`
            );
          }
        } else {
          // filteredCount > baselineCount — should never happen
          console.log(
            `[orders-status-filter] UNEXPECTED: filtered count (${filteredCount}) exceeds baseline (${baselineCount})`
          );
        }
      }

      // The test passes if we reach here without error.
      // The console logs and counts provide the diagnostic signal.
      expect(true).toBe(true);
    },
    120_000 // 2 min timeout for multiple wire calls
  );
});
```

---

## 4. Test execution attempt

**Environment:** Local dev environment, no sandbox credentials configured.

**Command:** `pnpm test:integration`

**Result:**

```
[integration] PAX8_CLIENT_ID / PAX8_CLIENT_SECRET not set — skipping wire-level integration tests. This is expected for forks, local dev, and credential-less CI runs.

Test Files  2 skipped (2)
     Tests  2 skipped (2)
Duration  451ms
```

**Outcome:** Test is cleanly skipped when credentials are absent, as designed. The harness gate worked as intended — no exception, no false failure.

---

## 5. One-sentence recommendation

**Needs sandbox run by maintainer with `PAX8_CLIENT_ID` / `PAX8_CLIENT_SECRET` configured** — proposed test above can be added to `e2e/integration/` and run via `pnpm test:integration` to observe whether the server honors the `--status` filter; if yes, soften the disclaimer to acknowledge the server accepts it despite the spec gap; if no, current disclaimer is accurate.

---

## Notes for maintainer

1. **To execute the test:**
   - Copy the proposed test code above to `e2e/integration/orders-status-filter.integration.test.ts`
   - Set `PAX8_CLIENT_ID` and `PAX8_CLIENT_SECRET` from sandbox credentials
   - Run `pnpm build && pnpm test:integration`
   - Examine the console output (`[orders-status-filter]` prefixed lines) to determine filter behavior

2. **Expected outcomes:**
   - **Filter honored:** Counts drop when `--status` is applied; all returned orders match the filter value
   - **Filter ignored:** Counts unchanged; returned orders may have any status
   - **Inconclusive:** Sandbox has no orders or no status field in responses

3. **Follow-up actions:**
   - If filter is honored: file a doc-gap issue to Pax8 API team to add `status` to the OpenAPI spec
   - If filter is ignored: close as expected behavior; current disclaimer is correct
   - If inconclusive: note the sandbox state and re-test with a fuller order set

4. **This audit does not**:
   - Modify any CLI source code
   - Make live API calls (test is read-only on the CLI, wire calls only happen in `pnpm test:integration` when credentials are present)
   - Commit the test fixture (proposed code is for this doc only; maintainer decides whether to adopt it)
