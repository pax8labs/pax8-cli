import { describe, it, expect } from "vitest";
import {
  companies,
  subscriptions,
  products,
  invoices,
  invoiceItems,
  orders,
  contacts,
  usageSummaries,
  usageLines,
  quotes,
  webhooks,
  webhookLogs,
  webhookTopics,
} from "./demo-data.js";

// ─── Helper ──────────────────────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("demo-data", () => {
  describe("data arrays are non-empty", () => {
    it("companies", () => expect(companies.length).toBeGreaterThan(0));
    it("subscriptions", () => expect(subscriptions.length).toBeGreaterThan(0));
    it("products", () => expect(products.length).toBeGreaterThan(0));
    it("invoices", () => expect(invoices.length).toBeGreaterThan(0));
    it("invoiceItems", () => expect(invoiceItems.length).toBeGreaterThan(0));
    it("orders", () => expect(orders.length).toBeGreaterThan(0));
    it("contacts", () => expect(contacts.length).toBeGreaterThan(0));
    it("usageSummaries", () => expect(usageSummaries.length).toBeGreaterThan(0));
    it("usageLines", () => expect(usageLines.length).toBeGreaterThan(0));
    it("quotes", () => expect(quotes.length).toBeGreaterThan(0));
    it("webhooks", () => expect(webhooks.length).toBeGreaterThan(0));
    it("webhookLogs", () => expect(webhookLogs.length).toBeGreaterThan(0));
    it("webhookTopics", () => expect(webhookTopics.length).toBeGreaterThan(0));
  });

  describe("companies have valid UUIDs", () => {
    it("all company IDs match UUID format", () => {
      for (const company of companies) {
        expect(company.id).toMatch(UUID_RE);
      }
    });
  });

  describe("expected company count", () => {
    it("has exactly 5 companies", () => {
      expect(companies).toHaveLength(5);
    });

    it("includes all expected companies by name", () => {
      const names = companies.map((c) => c.name);
      expect(names).toContain("Acme Corp");
      expect(names).toContain("Contoso Ltd");
      expect(names).toContain("Fabrikam Inc");
      expect(names).toContain("Northwind Traders");
      expect(names).toContain("Adventure Works");
    });
  });

  describe("subscriptions have renewal dates within 30 days", () => {
    it("at least one subscription renews within 7 days", () => {
      const now = Date.now();
      const sevenDays = 7 * 86_400_000;
      const found = subscriptions.some((s) => {
        if (!s.commitmentTermEndDate) return false;
        const diff = new Date(s.commitmentTermEndDate).getTime() - now;
        return diff > 0 && diff <= sevenDays;
      });
      expect(found).toBe(true);
    });

    it("at least one subscription renews within 14 days", () => {
      const now = Date.now();
      const fourteenDays = 14 * 86_400_000;
      const found = subscriptions.some((s) => {
        if (!s.commitmentTermEndDate) return false;
        const diff = new Date(s.commitmentTermEndDate).getTime() - now;
        return diff > 0 && diff <= fourteenDays;
      });
      expect(found).toBe(true);
    });

    it("at least one subscription renews within 30 days", () => {
      const now = Date.now();
      const thirtyDays = 30 * 86_400_000;
      const found = subscriptions.some((s) => {
        if (!s.commitmentTermEndDate) return false;
        const diff = new Date(s.commitmentTermEndDate).getTime() - now;
        return diff > 0 && diff <= thirtyDays;
      });
      expect(found).toBe(true);
    });
  });

  describe("invoice discrepancies exist", () => {
    it("Acme Corp M365 BP: invoiced quantity != active subscription quantity (overcharge)", () => {
      // Acme has 45 active M365 Business Premium seats
      const acmeM365BPSubs = subscriptions.filter(
        (s) =>
          s.companyId === "a1b2c3d4-e5f6-7890-abcd-ef1234567890" &&
          s.productId === "prod-m365-biz-prem-0001" &&
          s.status === "Active"
      );
      const activeQty = acmeM365BPSubs.reduce((sum, s) => sum + s.quantity, 0);

      // Invoice line says 50 seats
      const invoiceLine = invoiceItems.find(
        (ii) =>
          ii.companyId === "a1b2c3d4-e5f6-7890-abcd-ef1234567890" &&
          ii.productId === "prod-m365-biz-prem-0001"
      );

      expect(invoiceLine).toBeDefined();
      expect(invoiceLine!.quantity).toBe(50);
      expect(activeQty).toBe(45);
      expect(invoiceLine!.quantity).toBeGreaterThan(activeQty); // overcharge
    });

    it("Fabrikam Azure AD P1: invoiced but no active subscription (unexpected)", () => {
      // Fabrikam has no Azure AD Premium P1 subscription
      const fabrikamAADSubs = subscriptions.filter(
        (s) =>
          s.companyId === "c3d4e5f6-a7b8-9012-cdef-123456789012" &&
          s.productId === "prod-aad-p1-0008" &&
          s.status === "Active"
      );
      expect(fabrikamAADSubs).toHaveLength(0);

      // But there is an invoice item for it
      const invoiceLine = invoiceItems.find(
        (ii) =>
          ii.companyId === "c3d4e5f6-a7b8-9012-cdef-123456789012" &&
          ii.productId === "prod-aad-p1-0008"
      );
      expect(invoiceLine).toBeDefined();
      expect(invoiceLine!.quantity).toBeGreaterThan(0);
    });
  });

  describe("subscriptions per company", () => {
    it("Acme Corp has 12 subscriptions", () => {
      const acme = subscriptions.filter(
        (s) => s.companyId === "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      );
      expect(acme).toHaveLength(12);
    });

    it("Contoso Ltd has 8 subscriptions", () => {
      const contoso = subscriptions.filter(
        (s) => s.companyId === "b2c3d4e5-f6a7-8901-bcde-f12345678901"
      );
      expect(contoso).toHaveLength(8);
    });

    it("Fabrikam Inc has 3 subscriptions", () => {
      const fabrikam = subscriptions.filter(
        (s) => s.companyId === "c3d4e5f6-a7b8-9012-cdef-123456789012"
      );
      expect(fabrikam).toHaveLength(3);
    });
  });

  describe("subscription statuses vary", () => {
    it("has Active subscriptions", () => {
      expect(subscriptions.some((s) => s.status === "Active")).toBe(true);
    });

    it("has Trial subscriptions", () => {
      expect(subscriptions.some((s) => s.status === "Trial")).toBe(true);
    });

    it("has PendingManual subscriptions", () => {
      expect(subscriptions.some((s) => s.status === "PendingManual")).toBe(true);
    });
  });

  describe("billing terms vary", () => {
    it("has Monthly subscriptions", () => {
      expect(subscriptions.some((s) => s.billingTerm === "Monthly")).toBe(true);
    });

    it("has Annual subscriptions", () => {
      expect(subscriptions.some((s) => s.billingTerm === "Annual")).toBe(true);
    });
  });

  describe("invoices span 3 months", () => {
    it("has invoices for at least 3 distinct months", () => {
      const months = new Set(
        invoices.map((i) => i.invoiceDate.slice(0, 7))
      );
      expect(months.size).toBeGreaterThanOrEqual(3);
    });
  });
});
