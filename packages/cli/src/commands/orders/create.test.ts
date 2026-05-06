import { describe, it, expect } from "vitest";
import { runCli, runCliExpectSuccess } from "../../__tests__/test-utils.js";

describe("orders create", () => {
  it("creates order in demo mode with --yes --json", async () => {
    const result = await runCliExpectSuccess([
      "orders", "create",
      "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "--product", "prod-m365-biz-prem-0001",
      "--quantity", "5",
      "--yes", "--json",
    ]);
    const order = JSON.parse(result.stdout);
    expect(order).toHaveProperty("id");
    expect(order.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    // Issue #57: JSON output includes cost impact fields
    expect(order).toHaveProperty("unitPrice");
    expect(order).toHaveProperty("monthlyCost");
    expect(order).toHaveProperty("annualCost");
  });

  it("shows company and product names in preview", async () => {
    const result = await runCliExpectSuccess([
      "orders", "create",
      "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "--product", "prod-m365-biz-prem-0001",
      "--quantity", "10",
      "--yes",
    ]);
    expect(result.stderr).toContain("Order Preview");
    expect(result.stderr).toContain("Summit Healthcare Partners");
    expect(result.stderr).toContain("Microsoft 365 Business Premium [New Commerce Experience]");
  });

  it("includes cost impact in JSON output after order creation", async () => {
    const result = await runCliExpectSuccess([
      "orders", "create",
      "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "--product", "prod-m365-biz-prem-0001",
      "--quantity", "10",
      "--yes", "--json",
    ]);
    const order = JSON.parse(result.stdout);
    // Issue #57: JSON output includes cost impact fields
    expect(order.unitPrice).toBeTypeOf("number");
    expect(order.unitPrice).toBeGreaterThan(0);
    expect(order.monthlyCost).toBeTypeOf("number");
    expect(order.monthlyCost).toBeGreaterThan(0);
    expect(order.annualCost).toBeTypeOf("number");
    expect(order.annualCost).toBe(order.monthlyCost * 12);
  });

  it("rejects quantity 0 with clear error", async () => {
    const result = await runCli([
      "orders", "create",
      "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "--product", "prod-m365-biz-prem-0001",
      "--quantity", "0",
      "--yes",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid quantity");
    expect(result.stderr).not.toContain("Order Preview");
  });

  it("rejects negative quantity with clear error", async () => {
    const result = await runCli([
      "orders", "create",
      "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "--product", "prod-m365-biz-prem-0001",
      "--quantity", "-5",
      "--yes",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid quantity");
  });

  it("in REPL mode without --yes shows order preview but does not create", async () => {
    const result = await runCli(
      [
        "orders", "create",
        "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product", "prod-m365-biz-prem-0001",
        "--quantity", "5",
      ],
      { PAX8_REPL: "1" },
    );
    expect(result.stderr).toContain("Order Preview");
    // Without --yes and no TTY input, order should not be created
    expect(result.stderr).not.toContain("Order created");
  });

  it("in REPL mode with --yes executes the order", async () => {
    const result = await runCliExpectSuccess(
      [
        "orders", "create",
        "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product", "prod-m365-biz-prem-0001",
        "--quantity", "5",
        "--yes",
      ],
      { PAX8_REPL: "1" },
    );
    expect(result.stderr).toContain("Order created");
  });
});
