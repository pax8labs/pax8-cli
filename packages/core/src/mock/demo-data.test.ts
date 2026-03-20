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
      expect(names).toContain("Summit Healthcare Partners");
      expect(names).toContain("Coastline Legal Group");
      expect(names).toContain("Redwood Manufacturing");
      expect(names).toContain("Bright Minds Academy");
      expect(names).toContain("Pinnacle Financial Advisors");
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
    it("Summit Healthcare M365 BP: invoiced 95 seats but only 85 active (overcharge)", () => {
      const summitId = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
      const summitM365BPSubs = subscriptions.filter(
        (s) =>
          s.companyId === summitId &&
          s.productId === "prod-m365-biz-prem-0001" &&
          s.status === "Active"
      );
      const activeQty = summitM365BPSubs.reduce((sum, s) => sum + s.quantity, 0);

      const invoiceLine = invoiceItems.find(
        (ii) =>
          ii.companyId === summitId &&
          ii.productId === "prod-m365-biz-prem-0001"
      );

      expect(invoiceLine).toBeDefined();
      expect(invoiceLine!.quantity).toBe(95);
      expect(activeQty).toBe(85);
      expect(invoiceLine!.quantity).toBeGreaterThan(activeQty); // overcharge
    });

    it("Bright Minds Azure AD P1: invoiced but no active subscription (unexpected)", () => {
      const brightId = "d4e5f6a7-b8c9-0123-defa-234567890123";
      const brightAADSubs = subscriptions.filter(
        (s) =>
          s.companyId === brightId &&
          s.productId === "prod-aad-p1-0008" &&
          s.status === "Active"
      );
      expect(brightAADSubs).toHaveLength(0);

      const invoiceLine = invoiceItems.find(
        (ii) =>
          ii.companyId === brightId &&
          ii.productId === "prod-aad-p1-0008"
      );
      expect(invoiceLine).toBeDefined();
      expect(invoiceLine!.quantity).toBeGreaterThan(0);
    });

    it("Redwood Manufacturing E5: active subscription but missing from invoice (undercharge)", () => {
      const redwoodId = "c3d4e5f6-a7b8-9012-cdef-123456789012";
      const redwoodE5Subs = subscriptions.filter(
        (s) =>
          s.companyId === redwoodId &&
          s.productId === "prod-m365-e5-0004" &&
          s.status === "Active"
      );
      expect(redwoodE5Subs.length).toBeGreaterThan(0);
      const activeQty = redwoodE5Subs.reduce((sum, s) => sum + s.quantity, 0);
      expect(activeQty).toBe(50);

      // E5 line should be missing from current month invoice
      const e5InvoiceLine = invoiceItems.find(
        (ii) =>
          ii.invoiceId === "inv-redwood-curr-001" &&
          ii.productId === "prod-m365-e5-0004"
      );
      expect(e5InvoiceLine).toBeUndefined(); // missing = undercharge
    });
  });

  describe("subscriptions per company", () => {
    it("Summit Healthcare Partners has 5 subscriptions", () => {
      const summit = subscriptions.filter(
        (s) => s.companyId === "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
      );
      expect(summit).toHaveLength(5);
    });

    it("Coastline Legal Group has 3 subscriptions", () => {
      const coastline = subscriptions.filter(
        (s) => s.companyId === "b2c3d4e5-f6a7-8901-bcde-f12345678901"
      );
      expect(coastline).toHaveLength(3);
    });

    it("Redwood Manufacturing has 7 subscriptions", () => {
      const redwood = subscriptions.filter(
        (s) => s.companyId === "c3d4e5f6-a7b8-9012-cdef-123456789012"
      );
      expect(redwood).toHaveLength(7);
    });

    it("Bright Minds Academy has 2 subscriptions", () => {
      const bright = subscriptions.filter(
        (s) => s.companyId === "d4e5f6a7-b8c9-0123-defa-234567890123"
      );
      expect(bright).toHaveLength(2);
    });

    it("Pinnacle Financial Advisors has 3 subscriptions", () => {
      const pinnacle = subscriptions.filter(
        (s) => s.companyId === "e5f6a7b8-c9d0-1234-efab-345678901234"
      );
      expect(pinnacle).toHaveLength(3);
    });
  });

  describe("subscription statuses vary", () => {
    it("has Active subscriptions", () => {
      expect(subscriptions.some((s) => s.status === "Active")).toBe(true);
    });

    it("has Trial subscriptions", () => {
      expect(subscriptions.some((s) => s.status === "Trial")).toBe(true);
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
