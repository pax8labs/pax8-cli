// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 orders", () => {
  describe("orders list", () => {
    it("returns order data in JSON format wrapped with a page envelope (#478)", async () => {
      // #478: `--json` now wraps the result as `{ orders, page }` so agents
      // crawling large portfolios can see pagination instead of silently
      // truncating at row 25. Pre-#478 the output was a flat array and the
      // partner had no signal there were more pages.
      const result = await runCliExpectSuccess(["orders", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      // #478: wrapped envelope (was flat array pre-fix); #532: canonical
      // createdAt field name (was createdDate shadow pre-removal).
      expect(Array.isArray(data)).toBe(false);
      expect(data).toHaveProperty("orders");
      expect(data).toHaveProperty("page");
      expect(Array.isArray(data.orders)).toBe(true);
      expect(data.orders.length).toBeGreaterThan(0);
      expect(data.orders[0]).toHaveProperty("id");
      expect(data.orders[0]).toHaveProperty("companyName");
      expect(data.orders[0]).toHaveProperty("status");
      expect(data.orders[0]).toHaveProperty("createdAt");
    });

    it("page envelope reports 1-based page number plus totals (#478)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--json",
        "--page",
        "1",
        "--size",
        "2",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.page).toMatchObject({
        number: 1,
        size: 2,
      });
      expect(typeof data.page.totalElements).toBe("number");
      expect(typeof data.page.totalPages).toBe("number");
      expect(data.page.totalElements).toBeGreaterThanOrEqual(data.orders.length);
    });

    it("--with-actions adds a next-page nextActions entry when more pages exist (#478)", async () => {
      // Force multi-page by using size=1 — the small fixture has 5 orders so
      // totalPages will be >= 5.
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--json",
        "--with-actions",
        "--page",
        "1",
        "--size",
        "1",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data).toHaveProperty("nextActions");
      expect(Array.isArray(data.nextActions)).toBe(true);
      // First nextAction should be the "fetch next page" entry.
      const fetchNext = data.nextActions.find((a: { command: string }) =>
        a.command.includes("--page 2"),
      );
      expect(fetchNext).toBeDefined();
      expect(fetchNext.command).toContain("pax8 orders list");
      expect(fetchNext.command).toContain("--page 2");
    });

    it("--with-actions omits the next-page entry on the last page (#478)", async () => {
      // Land on the final page (size=1, page=totalPages). Re-fetch first to
      // discover totalPages from the envelope.
      const probe = await runCliExpectSuccess([
        "orders",
        "list",
        "--json",
        "--size",
        "1",
      ]);
      const totalPages = JSON.parse(probe.stdout).page.totalPages;
      expect(totalPages).toBeGreaterThan(1);

      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--json",
        "--with-actions",
        "--size",
        "1",
        "--page",
        String(totalPages),
      ]);
      const data = JSON.parse(result.stdout);
      const fetchNext = (data.nextActions as { command: string }[]).find((a) =>
        a.command.includes(`--page ${totalPages + 1}`),
      );
      expect(fetchNext).toBeUndefined();
    });

    it("default sort is newest-first (#478)", async () => {
      // Pre-#478 the CLI sent no sort hint and the real Pax8 API returned
      // 2013-era orders in row 1. Now every adjacent pair must be in
      // descending createdAt order — covers both the fixed fixture rows
      // and any `ord-demo-*` rows that `orders create` tests left behind
      // (those carry today's date and so legitimately sort first).
      const result = await runCliExpectSuccess(["orders", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.orders.length).toBeGreaterThan(0);
      for (let i = 1; i < data.orders.length; i++) {
        const prev = String(data.orders[i - 1].createdAt);
        const curr = String(data.orders[i].createdAt);
        expect(prev >= curr).toBe(true);
      }
      // Among the fixed fixture rows (no `ord-demo-` prefix) the most-recent
      // is `ord-summit-001` (2026-03-08). It should be the first such row.
      const firstFixtureRow = data.orders.find(
        (o: { id: string }) => !o.id.startsWith("ord-demo-"),
      );
      expect(firstFixtureRow?.id).toBe("ord-summit-001");
    });

    it("emits canonical `createdAt` (#385); legacy `createdDate` is dropped", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(data.orders.length).toBeGreaterThan(0);
      for (const row of data.orders) {
        expect(row).toHaveProperty("createdAt");
        expect(row).not.toHaveProperty("createdDate");
      }
    });

    it("outputs data by default (non-TTY falls back to JSON)", async () => {
      const result = await runCliExpectSuccess(["orders", "list"]);
      const data = JSON.parse(result.stdout);
      // The first fixture row (skipping any `ord-demo-*` rows seeded by
      // co-running `orders create` tests) is `ord-summit-001`.
      const firstFixtureRow = data.orders.find(
        (o: { id: string }) => !o.id.startsWith("ord-demo-"),
      );
      expect(firstFixtureRow?.id).toBe("ord-summit-001");
    });

    it("filters by company ID", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.orders.length).toBeGreaterThan(0);
      for (const order of data.orders) {
        expect(order.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });

    it("supports pagination", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "list",
        "--page",
        "1",
        "--size",
        "2",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.orders.length).toBe(2);
    });

    it("shows table footer with page indicator on stderr (#478)", async () => {
      // Subprocess runs are non-TTY, which forces JSON by default. Use the
      // PAX8_OUTPUT_FORMAT escape hatch to exercise the table-mode footer.
      const result = await runCliExpectSuccess(["orders", "list"], {
        PAX8_OUTPUT_FORMAT: "table",
      });
      // Footer surfaces "Page X of Y — N orders" so pagination is visible
      // to humans inspecting the default table output.
      expect(result.stderr).toMatch(/Page \d+ of \d+/);
      expect(result.stderr).toContain("orders");
    });

    it("table footer's next-page hint appears only when more pages exist (#478)", async () => {
      // size=1 against the small fixture guarantees multiple pages.
      const multi = await runCliExpectSuccess(
        ["orders", "list", "--size", "1", "--page", "1"],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      expect(multi.stderr).toMatch(/next:\s*pax8 orders list --page 2/);

      // On the final page the hint is suppressed.
      const probe = await runCliExpectSuccess([
        "orders",
        "list",
        "--json",
        "--size",
        "1",
      ]);
      const totalPages = JSON.parse(probe.stdout).page.totalPages;
      const last = await runCliExpectSuccess(
        ["orders", "list", "--size", "1", "--page", String(totalPages)],
        { PAX8_OUTPUT_FORMAT: "table" },
      );
      expect(last.stderr).not.toMatch(/next:\s*pax8 orders list/);
    });

    it("populates Company column for orders beyond the first 200 companies (#478 defect 4)", async () => {
      // The large fixture has 1000 companies and 45000 orders. Pre-#478 the
      // CLI fetched only the first 200 companies for name enrichment, so
      // 80% of rows showed a blank Company column on real partner data.
      // After the fix the enrichment pages until every referenced ID is
      // covered. Set `--size 50` so we get plenty of rows from many
      // different companies and the test fails LOUDLY if a regression
      // re-introduces the 200-cap (the demo's hostile-name companies tend
      // to sort later than index 200).
      const result = await runCliExpectSuccess(
        ["orders", "list", "--json", "--size", "50", "--page", "1"],
        { PAX8_DEMO_SCALE: "large" },
      );
      const data = JSON.parse(result.stdout);
      expect(data.orders.length).toBeGreaterThan(0);
      const blank = data.orders.filter(
        (o: { companyName?: string; companyId: string }) =>
          !o.companyName || o.companyName === o.companyId,
      );
      // Every row must resolve to a real company name. Pre-fix this was
      // ~40 of 50; we assert zero.
      expect(blank).toHaveLength(0);
    });

    it("rejects --status (flag removed in #478)", async () => {
      // #478 defect 3: pre-fix the CLI accepted `--status` and passed it to
      // a server that silently ignored it. Partners running
      // `pax8 orders list --status Completed | grep Completed` had no way to
      // know they were looking at unfiltered data. The flag is removed
      // entirely — Commander errors with `unknown option` and exit code 1.
      const result = await runCliExpectFailure([
        "orders",
        "list",
        "--status",
        "Completed",
      ]);
      expect(result.stderr).toMatch(/unknown option|--status/i);
    });

    // #199 — the `/orders` endpoint is slow on large portfolios; the 30s
    // default timeout fires there in real-world use. Before this fix the
    // user saw only "Request timed out after 30000ms" with no hint of what
    // to do. The injection env var lets the mock client raise the same
    // shape of `ApiError` the real client throws on AbortController abort.
    it("surfaces an actionable hint on timeout (#199)", async () => {
      const result = await runCliExpectFailure(["orders", "list"], {
        PAX8_DEMO_FAIL_ORDERS_LIST_TIMEOUT: "1",
      });
      // The original timeout message is preserved so partners and agents
      // still know *what* failed.
      expect(result.stderr).toContain("timed out");
      // Orders-specific hint: smaller page size + per-company filter.
      expect(result.stderr).toContain("--size");
      expect(result.stderr).toContain("--company");
      // Generic env-var escape hatch is always present.
      expect(result.stderr).toContain("PAX8_TIMEOUT_MS");
    });

    it("emits ERROR_API_TIMEOUT in --json error envelope on timeout (#199)", async () => {
      const result = await runCliExpectFailure(
        ["orders", "list", "--json"],
        { PAX8_DEMO_FAIL_ORDERS_LIST_TIMEOUT: "1" },
      );
      // The structured envelope lives on stderr (stdout is the data
      // channel). The "✨ Demo mode" banner and any spinner frames also go
      // to stderr, so isolate the JSON object before parsing. Brace-balance
      // pass — handleCommandError pretty-prints with 2-space indent.
      const start = result.stderr.indexOf("{");
      const end = result.stderr.lastIndexOf("}");
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      const envelope = JSON.parse(result.stderr.slice(start, end + 1));
      expect(envelope.code).toBe("ERROR_API_TIMEOUT");
      expect(envelope.recoverySteps).toBeDefined();
      const joined = envelope.recoverySteps.join(" ");
      expect(joined).toMatch(/--size/);
      expect(joined).toMatch(/--company/);
      expect(joined).toMatch(/PAX8_TIMEOUT_MS/);
    });
  });

  describe("orders show", () => {
    it("returns order details in JSON format", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-summit-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toBe("ord-summit-001");
      expect(data.companyName).toBe("Summit Healthcare Partners");
      expect(data.status).toBe("Completed");
      expect(data.lineItems).toBeDefined();
      expect(data.lineItems.length).toBeGreaterThan(0);
    });

    it("shows order with line items", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-summit-001",
      ]);
      // Non-TTY defaults to JSON
      const data = JSON.parse(result.stdout);
      expect(data.lineItems[0].productName).toBe("CrowdStrike MSSP Complete Defend");
      expect(data.lineItems[0].quantity).toBe(85);
    });

    it("shows order with multiple line items", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "show",
        "ord-pinnacle-001",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.lineItems.length).toBe(2);
      expect(data.lineItems[0].productName).toContain("Microsoft 365");
      expect(data.lineItems[1].productName).toContain("Defender");
    });
  });

  describe("orders --help", () => {
    it("shows orders subcommands", async () => {
      const result = await runCliExpectSuccess(["orders", "--help"]);
      expect(result.stdout).toContain("list");
      expect(result.stdout).toContain("show");
      expect(result.stdout).toContain("create");
    });

    it("shows list help with examples", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--help"]);
      expect(result.stdout).toContain("Examples:");
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toContain("--page");
    });

    // #478: `--status` was removed entirely (the server silently ignored it
    // and there's no real backend contract until #369 lands). The help
    // surface should no longer advertise the flag; partners get a clean
    // "unknown option" error instead of a silently-unfiltered list.
    it("--status flag is no longer documented in --help (#478)", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--help"]);
      expect(result.stdout).not.toMatch(/--status/);
      // Bare-list framing (pre-#250) must not regress either.
      expect(result.stdout).not.toMatch(
        /Filter by status \(Completed, Processing, Failed, PendingManual\)/,
      );
    });

    it("shows show help with examples", async () => {
      const result = await runCliExpectSuccess(["orders", "show", "--help"]);
      expect(result.stdout).toContain("Examples:");
    });

    it("shows create help with required options", async () => {
      const result = await runCliExpectSuccess(["orders", "create", "--help"]);
      expect(result.stdout).toContain("--company");
      expect(result.stdout).toContain("--product");
      expect(result.stdout).toContain("Examples:");
    });
  });

  describe("orders create validation", () => {
    it("errors when --company flag is missing", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--product",
        "prod-m365-biz-prem-0001",
      ]);
      expect(result.stderr).toContain("--company");
    });

    it("errors when --product flag is missing", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      expect(result.stderr).toContain("--product");
    });

    it("errors with invalid quantity", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "-5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/[Ii]nvalid quantity/);
    });

    it("errors when neither --product nor --line-item is passed", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/--product|--line-item/);
    });

    it("errors when --product and --line-item are mixed (#246)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "5",
        "--line-item",
        "product=prod-defender-p1,quantity=10",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      // Error should call out the conflict explicitly rather than picking
      // one side or trying to merge them.
      expect(combined).toMatch(/Cannot mix.*--product.*--line-item|--product.*--line-item.*not both/i);
    });

    // #408 / partner-walkthrough finding #8: a partner's first guess at a
    // product name shouldn't dead-end with "Product not found" — surface
    // inline "Did you mean: ..." suggestions with product IDs so the
    // recovery path stays one round-trip away rather than requiring a
    // separate `pax8 products search` call.
    it("surfaces 'Did you mean' suggestions when --product is ambiguous (#408)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "Microsoft 365",
        "--quantity",
        "5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      // "Microsoft 365" is a prefix of several products in the demo catalog,
      // so the resolver hits the multiple-matches branch — same UX shape:
      // a "Did you mean" list with copy-pasteable IDs.
      expect(combined).toContain("Did you mean");
      expect(combined).toMatch(/Microsoft 365 Business Premium/);
      expect(combined).toContain("prod-m365-biz-prem-0001");
    });

    it("surfaces 'Did you mean' when --product is a typo with no exact match (#408)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "Microsoft365",
        "--quantity",
        "5",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain("not found");
      // Even without an exact prefix match, token-overlap ranking should
      // surface Microsoft products as the closest catalog entries.
      expect(combined).toMatch(/Did you mean|products search/);
    });

    it("fails fast with helpful list when --billing-term is invalid (#408)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "5",
        "--billing-term",
        "Quarterly",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toContain(`Invalid value for --billing-term: "Quarterly"`);
      expect(combined).toContain("Monthly");
      expect(combined).toContain("Annual");
    });

    it("errors on malformed --line-item spec (#246)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--line-item",
        "garbage-no-equals-sign",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/Invalid --line-item|key=value/i);
    });

    it("errors when --line-item is missing required keys (#246)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--line-item",
        "product=prod-defender-p1",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/quantity/i);
    });

    // Regression for #230: when a product requires a commitment term (every
    // pricing plan has commitmentTerm) AND the customer has no existing
    // subscription for that product (so resolveCommitmentTermId can't copy a
    // UUID), the order command must fail at preview-time with a clear,
    // actionable error — NOT proceed to a misleading preview ("Commitment:
    // Monthly") and only fail after the user confirmed and the API rejected.
    //
    // Acme Corp does not have an M365 E3 subscription in the demo fixtures;
    // M365 E3 has commitmentTerm on every pricing plan. Together that
    // triggers the pre-flight check.
    it("fails clearly when product requires commitment but no existing subscription (#230)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-e3-0003",
        "--quantity",
        "1",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      // Error is surfaced before the preview/confirm — there is no "Order
      // Preview" or "Place order" prompt in the output.
      expect(combined).not.toMatch(/Place order/);
      // The error names the actual failure mode and includes recovery steps.
      expect(combined).toMatch(/requires.*commitment/i);
      expect(combined).toMatch(/--commitment-term/);
      expect(combined).toMatch(/Pax8 portal/);
    });
  });

  describe("orders create — multi-line and dry-run (#246)", () => {
    it("creates a single-line order (back-compat smoke test)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "5",
        "--billing-term",
        "Monthly",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toMatch(/^ord-demo-/);
      expect(data.companyName).toBe("Acme Corp");
      expect(data.lineItems).toHaveLength(1);
      expect(data.lineItems[0].quantity).toBe(5);
      // `lineItemNumber` is spec-required (#331) — the mock client echoes
      // the value sent on the wire, so a 1 here proves the CLI populated it.
      expect(data.lineItems[0].lineItemNumber).toBe(1);
      // Single-line back-compat: unitPrice is at the top level (pre-#246
      // shape) when there's exactly one line item.
      expect(data).toHaveProperty("unitPrice");
      // Dry-run flag is not set in normal mode.
      expect(data.dryRun).toBeUndefined();
    });

    it("creates a multi-line order with --line-item (#246)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=5",
        "--line-item",
        "product=prod-defender-biz-0007,quantity=3,billing-term=Monthly",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toMatch(/^ord-demo-/);
      expect(data.companyName).toBe("Acme Corp");
      expect(data.lineItems).toHaveLength(2);
      expect(data.lineItems[0].productId).toBe("prod-m365-biz-prem-0001");
      expect(data.lineItems[0].quantity).toBe(5);
      expect(data.lineItems[1].productId).toBe("prod-defender-biz-0007");
      expect(data.lineItems[1].quantity).toBe(3);
      // Multi-line: each line gets a sequential 1-based lineItemNumber (#331).
      expect(data.lineItems.map((li: { lineItemNumber: number }) => li.lineItemNumber))
        .toEqual([1, 2]);
    });

    it("populates lineItemNumber=1 on a single-line order (#331)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "1",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.lineItems).toHaveLength(1);
      expect(data.lineItems[0].lineItemNumber).toBe(1);
    });

    it("populates sequential lineItemNumber on multi-line orders (#331)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=5",
        "--line-item",
        "product=prod-defender-biz-0007,quantity=3",
        "--line-item",
        "product=prod-aad-p1-0008,quantity=2",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.lineItems).toHaveLength(3);
      const numbers = data.lineItems.map(
        (li: { lineItemNumber: number }) => li.lineItemNumber,
      );
      expect(numbers).toEqual([1, 2, 3]);
    });

    it("performs a dry-run without persisting the order (#246)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "5",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // The mock client signals a dry-run via the synthetic id prefix.
      expect(data.id).toMatch(/^ord-dryrun-/);
      expect(data.dryRun).toBe(true);
      expect(data.companyName).toBe("Acme Corp");
      expect(data.lineItems).toHaveLength(1);
      // The dry-run banner appears on stderr, never stdout (stdout is JSON).
      expect(result.stderr).toMatch(/DRY RUN|dry-run/i);
    });

    it("dry-run combines with --line-item for multi-line validation (#246)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=5",
        "--line-item",
        "product=prod-defender-biz-0007,quantity=3",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.id).toMatch(/^ord-dryrun-/);
      expect(data.dryRun).toBe(true);
      expect(data.lineItems).toHaveLength(2);
    });

    // #332 — the `--line-item` parser must accept `provisioning=<key>:<value>`
    // and produce the spec-shaped `Array<{key, values: string[]}>` on the
    // outgoing payload (not a flat record).
    it("parses provisioning=<key>:<value> in --line-item into spec-shaped array (#332)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=2,provisioning=domain:contoso.com",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      // Dry-run echoes the submitted payload back through the mock client,
      // which mirrors the wire shape — so a successful dry-run with this
      // spec proves the parser produced something the schema accepts.
      expect(data.dryRun).toBe(true);
      expect(data.lineItems).toHaveLength(1);
      // The mock client echoes `provisioningDetails` so we can pin the
      // exact shape: array of {key, values: string[]} per the public spec.
      expect(data.lineItems[0].provisioningDetails).toEqual([
        { key: "domain", values: ["contoso.com"] },
      ]);
    });

    it("parses multi-value provisioning entries with pipe separator (#332)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=2,provisioning=region:us-east|us-west",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.dryRun).toBe(true);
      expect(data.lineItems[0].provisioningDetails).toEqual([
        { key: "region", values: ["us-east", "us-west"] },
      ]);
    });

    it("accepts multiple provisioning entries within one --line-item (#332)", async () => {
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=2,provisioning=domain:contoso.com,provisioning=tier:premium",
        "--dry-run",
        "--yes",
        "--json",
      ]);
      const data = JSON.parse(result.stdout);
      expect(data.dryRun).toBe(true);
      expect(data.lineItems[0].provisioningDetails).toEqual([
        { key: "domain", values: ["contoso.com"] },
        { key: "tier", values: ["premium"] },
      ]);
    });

    it("errors when provisioning entry is missing the colon separator (#332)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=2,provisioning=nocolon",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/provisioning|<key>:<value>/i);
    });

    it("errors when provisioning entry has empty key (#332)", async () => {
      const result = await runCliExpectFailure([
        "orders",
        "create",
        "--company",
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--line-item",
        "product=prod-m365-biz-prem-0001,quantity=2,provisioning=:value",
        "--yes",
      ]);
      const combined = result.stdout + result.stderr;
      expect(combined).toMatch(/provisioning|missing key/i);
    });

    it("--dry-run prompt text says validate (TTY humans see it)", async () => {
      // Even with --yes the rendered preview banner mentions DRY RUN.
      const result = await runCliExpectSuccess([
        "orders",
        "create",
        "--company",
        "Acme Corp",
        "--product",
        "prod-m365-biz-prem-0001",
        "--quantity",
        "1",
        "--dry-run",
        "--yes",
      ]);
      // The DRY RUN banner is on stderr (preview/banner), and "no order
      // placed" is on stdout (post-write summary).
      expect(result.stderr).toMatch(/DRY RUN/);
    });
  });
});
