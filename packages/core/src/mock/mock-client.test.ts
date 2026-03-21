import { describe, it, expect } from "vitest";
import { MockPax8Client } from "./mock-client.js";

describe("MockPax8Client", () => {
  const client = new MockPax8Client();

  // ─── Companies ───────────────────────────────────────────────────────────

  describe("companies.list()", () => {
    it("returns paginated results", async () => {
      const result = await client.companies.list({ size: 2 });
      expect(result.content).toHaveLength(2);
      expect(result.page.totalElements).toBe(5);
      expect(result.page.totalPages).toBe(3);
      expect(result.page.number).toBe(0);
      expect(result.page.size).toBe(2);
    });

    it("returns all companies with large page size", async () => {
      const result = await client.companies.list({ size: 100 });
      expect(result.content).toHaveLength(5);
      expect(result.page.totalPages).toBe(1);
    });

    it("filters by name", async () => {
      const result = await client.companies.list({ filter: "summit" });
      expect(result.content).toHaveLength(1);
      expect(result.content[0].name).toBe("Summit Healthcare Partners");
    });

    it("returns empty for non-matching filter", async () => {
      const result = await client.companies.list({
        filter: "nonexistent-company",
      });
      expect(result.content).toHaveLength(0);
      expect(result.page.totalElements).toBe(0);
    });
  });

  describe("companies.get()", () => {
    it("returns correct company by ID", async () => {
      const company = await client.companies.get(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      );
      expect(company.name).toBe("Summit Healthcare Partners");
      expect(company.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("throws 404 for unknown ID", async () => {
      await expect(client.companies.get("nonexistent")).rejects.toThrow(
        "Company not found"
      );
    });
  });

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  describe("subscriptions.list()", () => {
    it("returns all subscriptions", async () => {
      const result = await client.subscriptions.list({ size: 100 });
      expect(result.content.length).toBeGreaterThanOrEqual(10);
    });

    it("filters by companyId", async () => {
      const result = await client.subscriptions.list({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        size: 100,
      });
      expect(result.content.length).toBe(5);
      expect(
        result.content.every(
          (s) => s.companyId === "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
        )
      ).toBe(true);
    });

    it("returns empty for non-matching companyId", async () => {
      const result = await client.subscriptions.list({
        companyId: "nonexistent",
      });
      expect(result.content).toHaveLength(0);
    });
  });

  // ─── Invoices ──────────────────────────────────────────────────────────────

  describe("invoices.list()", () => {
    it("returns invoices", async () => {
      const result = await client.invoices.list({ size: 100 });
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("filters by month", async () => {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const result = await client.invoices.list({
        month: currentMonth,
        size: 100,
      });
      expect(result.content.length).toBeGreaterThan(0);
      expect(
        result.content.every((i) => i.invoiceDate.startsWith(currentMonth))
      ).toBe(true);
    });

    it("returns empty for future month", async () => {
      const result = await client.invoices.list({ month: "2099-12" });
      expect(result.content).toHaveLength(0);
    });
  });

  // ─── Pagination ────────────────────────────────────────────────────────────

  describe("pagination", () => {
    it("page 0 vs page 1 return different items", async () => {
      const page0 = await client.companies.list({ page: 0, size: 2 });
      const page1 = await client.companies.list({ page: 1, size: 2 });

      expect(page0.content).toHaveLength(2);
      expect(page1.content).toHaveLength(2);
      expect(page0.content[0].id).not.toBe(page1.content[0].id);
    });

    it("last page may have fewer items", async () => {
      const lastPage = await client.companies.list({ page: 2, size: 2 });
      expect(lastPage.content).toHaveLength(1); // 5 companies, page 2 of size 2 = 1 item
    });

    it("page beyond total returns empty", async () => {
      const result = await client.companies.list({ page: 10, size: 2 });
      expect(result.content).toHaveLength(0);
    });
  });

  // ─── Latency ───────────────────────────────────────────────────────────────

  describe("simulated latency", () => {
    it("responds within 500ms", async () => {
      const start = Date.now();
      await client.companies.list();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(500);
    });

    it("responds with non-zero latency (>10ms)", async () => {
      const start = Date.now();
      await client.companies.list();
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(10);
    });
  });

  // ─── Products ──────────────────────────────────────────────────────────────

  describe("products", () => {
    it("list returns products", async () => {
      const result = await client.products.list({ size: 100 });
      expect(result.content.length).toBeGreaterThanOrEqual(10);
    });

    it("get returns correct product", async () => {
      const product = await client.products.get("prod-m365-biz-prem-0001");
      expect(product.name).toBe("Microsoft 365 Business Premium");
    });

    it("getPricing returns pricing for product", async () => {
      const pricing = await client.products.getPricing(
        "prod-m365-biz-prem-0001"
      );
      expect(pricing.length).toBeGreaterThan(0);
      expect(pricing[0]).toHaveProperty("billingTerm");
      expect(pricing[0]).toHaveProperty("partnerBuyPrice");
      expect(pricing[0]).toHaveProperty("commitmentTerm");
    });
  });

  // ─── Orders ────────────────────────────────────────────────────────────────

  describe("orders", () => {
    it("list returns orders", async () => {
      const result = await client.orders.list({ size: 100 });
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("get returns correct order", async () => {
      const order = await client.orders.get("ord-summit-001");
      expect(order.companyName).toBe("Summit Healthcare Partners");
    });
  });

  // ─── Contacts ──────────────────────────────────────────────────────────────

  describe("contacts", () => {
    it("list filters by companyId", async () => {
      const result = await client.contacts.list({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });
      expect(result.content.length).toBe(2);
    });
  });

  // ─── Webhooks ──────────────────────────────────────────────────────────────

  describe("webhooks", () => {
    it("list returns webhooks", async () => {
      const result = await client.webhooks.list();
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("listTopics returns topics", async () => {
      const topics = await client.webhooks.listTopics();
      expect(topics.length).toBeGreaterThan(0);
      expect(topics).toContain("subscription.created");
    });
  });
});
