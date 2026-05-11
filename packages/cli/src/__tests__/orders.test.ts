// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { runCliExpectSuccess, runCliExpectFailure } from "./test-utils.js";

describe("pax8 orders", () => {
  describe("orders list", () => {
    it("returns order data in JSON format", async () => {
      const result = await runCliExpectSuccess(["orders", "list", "--json"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      expect(data[0]).toHaveProperty("id");
      expect(data[0]).toHaveProperty("companyName");
      expect(data[0]).toHaveProperty("status");
      expect(data[0]).toHaveProperty("createdDate");
    });

    it("outputs data by default (non-TTY falls back to JSON)", async () => {
      const result = await runCliExpectSuccess(["orders", "list"]);
      const data = JSON.parse(result.stdout);
      expect(Array.isArray(data)).toBe(true);
      expect(data[0].id).toBe("ord-summit-001");
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
      expect(data.length).toBeGreaterThan(0);
      for (const order of data) {
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
      expect(data.length).toBe(2);
    });

    it("shows footer with order count on stderr", async () => {
      const result = await runCliExpectSuccess(["orders", "list"]);
      expect(result.stderr).toContain("orders");
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
