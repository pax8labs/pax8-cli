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

  it("in REPL mode without --yes shows confirm command", async () => {
    const result = await runCli(
      [
        "orders", "create",
        "--company", "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        "--product", "prod-m365-biz-prem-0001",
        "--quantity", "5",
      ],
      { PAX8_REPL: "1" },
    );
    expect(result.stderr).toContain("--yes");
    // Should NOT actually create the order
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
