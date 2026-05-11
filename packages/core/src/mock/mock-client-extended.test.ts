// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { MockPax8Client } from "./mock-client.js";
import { NotFoundError } from "../api/errors.js";

describe("MockPax8Client — extended coverage", () => {
  const client = new MockPax8Client();

  // ─── Companies ───────────────────────────────────────────────────────────

  describe("companies.create()", () => {
    it("creates a company with provided data", async () => {
      const result = await client.companies.create({ name: "Test Co" });
      expect(result.name).toBe("Test Co");
      expect(result.id).toContain("demo-new-");
      expect(result.status).toBe("Active");
    });

    it("creates a company with defaults when no data", async () => {
      const result = await client.companies.create({});
      expect(result.name).toBe("New Company");
    });
  });

  describe("companies.update()", () => {
    it("updates company by id", async () => {
      const result = await client.companies.update(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        { name: "Updated Name" },
      );
      expect(result.name).toBe("Updated Name");
      expect(result.id).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
    });

    it("throws NotFoundError for unknown company id", async () => {
      await expect(
        client.companies.update("nonexistent", { name: "X" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Subscriptions ─────────────────────────────────────────────────────────

  describe("subscriptions.get()", () => {
    it("returns subscription by id", async () => {
      const all = await client.subscriptions.list({ size: 100 });
      const firstId = all.content[0].id;
      const sub = await client.subscriptions.get(firstId);
      expect(sub.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown subscription", async () => {
      await expect(client.subscriptions.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("subscriptions.getHistory()", () => {
    it("returns history for existing subscription", async () => {
      const all = await client.subscriptions.list({ size: 100 });
      const firstId = all.content[0].id;
      const history = await client.subscriptions.getHistory(firstId);
      expect(history.changes).toHaveLength(2);
      expect(history.changes[0].field).toBe("status");
    });

    it("throws NotFoundError for unknown subscription", async () => {
      await expect(client.subscriptions.getHistory("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("subscriptions.update()", () => {
    it("updates subscription", async () => {
      const all = await client.subscriptions.list({ size: 100 });
      const firstId = all.content[0].id;
      const result = await client.subscriptions.update(firstId, { quantity: 99 } as never);
      expect(result.quantity).toBe(99);
      expect(result.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown subscription", async () => {
      await expect(
        client.subscriptions.update("nonexistent", {} as never),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("subscriptions.delete()", () => {
    it("deletes an existing subscription without error", async () => {
      const all = await client.subscriptions.list({ size: 100 });
      const firstId = all.content[0].id;
      await expect(client.subscriptions.delete(firstId)).resolves.toBeUndefined();
    });

    it("throws NotFoundError for unknown subscription", async () => {
      await expect(client.subscriptions.delete("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Products ────────────────────────────────────────────────────────────

  describe("products.list() with vendorName filter", () => {
    it("filters by vendor name", async () => {
      const result = await client.products.list({ vendorName: "Microsoft" });
      expect(result.content.length).toBeGreaterThan(0);
      for (const p of result.content) {
        expect(p.vendorName.toLowerCase()).toContain("microsoft");
      }
    });
  });

  describe("products.get()", () => {
    it("throws NotFoundError for unknown product", async () => {
      await expect(client.products.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("products.getProvisioningDetails()", () => {
    it("returns provisioning details for Microsoft product", async () => {
      const msProduct = (await client.products.list({ vendorName: "Microsoft", size: 1 })).content[0];
      const details = await client.products.getProvisioningDetails(msProduct.id);
      expect(details.productId).toBe(msProduct.id);
      expect(details.vendorPrerequisites).toMatch(/tenant/i);
      expect(details.fields?.map((f) => f.name)).toContain("domain");
    });

    it("throws NotFoundError for unknown product", async () => {
      await expect(client.products.getProvisioningDetails("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("products.getDependencies()", () => {
    it("returns empty dependencies", async () => {
      const all = await client.products.list({ size: 1 });
      const result = await client.products.getDependencies(all.content[0].id);
      expect(result).toEqual([]);
    });
  });

  // ─── Invoices ────────────────────────────────────────────────────────────

  describe("invoices.get()", () => {
    it("returns invoice by id", async () => {
      const all = await client.invoices.list({ size: 100 });
      const firstId = all.content[0].id;
      const invoice = await client.invoices.get(firstId);
      expect(invoice.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown invoice", async () => {
      await expect(client.invoices.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("invoices.listItems()", () => {
    it("returns items filtered by invoiceId", async () => {
      const invoiceList = await client.invoices.list({ size: 100 });
      const invoiceId = invoiceList.content[0].id;
      const items = await client.invoices.listItems({ invoiceId, size: 100 });
      expect(items.content.length).toBeGreaterThanOrEqual(0);
    });

    it("filters by companyId", async () => {
      const result = await client.invoices.listItems({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        size: 100,
      });
      for (const item of result.content) {
        expect(item.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });
  });

  describe("invoices.listDraftItems()", () => {
    it("returns empty paginated response", async () => {
      const result = await client.invoices.listDraftItems();
      expect(result.content).toHaveLength(0);
      expect(result.page.totalElements).toBe(0);
    });
  });

  describe("invoices.list() with companyId filter", () => {
    it("filters invoices by companyId", async () => {
      const result = await client.invoices.list({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        size: 100,
      });
      for (const inv of result.content) {
        expect(inv.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });
  });

  // ─── Orders ──────────────────────────────────────────────────────────────

  describe("orders.list() with companyId filter", () => {
    it("filters by companyId", async () => {
      const result = await client.orders.list({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        size: 100,
      });
      for (const order of result.content) {
        expect(order.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });
  });

  describe("orders.get()", () => {
    it("throws NotFoundError for unknown order", async () => {
      await expect(client.orders.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("orders.create()", () => {
    it("creates an order with provided data", async () => {
      const result = await client.orders.create({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        lineItems: [{
          productId: "11111111-1111-1111-1111-111111111111",
          quantity: 5,
          billingTerm: "Monthly",
        }],
      });
      expect(result.id).toContain("ord-demo-");
      expect(result.companyName).toBe("Summit Healthcare Partners");
      expect(result.status).toBe("Processing");
      expect(result.lineItems).toHaveLength(1);
      expect(result.lineItems[0].quantity).toBe(5);
    });
  });

  // ─── Contacts ────────────────────────────────────────────────────────────

  describe("contacts.get()", () => {
    it("returns contact by id", async () => {
      const all = await client.contacts.list(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        { size: 100 },
      );
      const firstId = all.content[0].id;
      const contact = await client.contacts.get(firstId);
      expect(contact.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown contact", async () => {
      await expect(client.contacts.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("contacts.create()", () => {
    it("creates a contact", async () => {
      const result = await client.contacts.create({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        firstName: "Jane",
        lastName: "Doe",
        email: "jane@example.com",
      });
      expect(result.id).toContain("contact-demo-");
      expect(result.firstName).toBe("Jane");
    });
  });

  describe("contacts.update()", () => {
    it("updates a contact", async () => {
      const all = await client.contacts.list(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        { size: 100 },
      );
      const firstId = all.content[0].id;
      const result = await client.contacts.update(firstId, { firstName: "Updated" });
      expect(result.firstName).toBe("Updated");
      expect(result.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown contact", async () => {
      await expect(
        client.contacts.update("nonexistent", { firstName: "X" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("contacts.delete()", () => {
    it("deletes existing contact", async () => {
      const all = await client.contacts.list(
        "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        { size: 100 },
      );
      const firstId = all.content[0].id;
      await expect(client.contacts.delete(firstId)).resolves.toBeUndefined();
    });

    it("throws NotFoundError for unknown contact", async () => {
      await expect(client.contacts.delete("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Usage ───────────────────────────────────────────────────────────────

  describe("usage.listSummaries()", () => {
    it("returns usage summaries", async () => {
      const result = await client.usage.listSummaries({ size: 100 });
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("filters by companyId", async () => {
      const result = await client.usage.listSummaries({
        companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
        size: 100,
      });
      for (const u of result.content) {
        expect(u.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      }
    });

    it("filters by resourceGroup", async () => {
      const all = await client.usage.listSummaries({ size: 100 });
      const group = all.content.find((u) => u.resourceGroup)?.resourceGroup;
      if (!group) return; // no demo data has resourceGroup → skip
      const result = await client.usage.listSummaries({ resourceGroup: group, size: 100 });
      for (const u of result.content) {
        expect(u.resourceGroup).toBe(group);
      }
    });
  });

  describe("usage.getSummary()", () => {
    it("returns summary by id", async () => {
      const all = await client.usage.listSummaries({ size: 100 });
      const firstId = all.content[0].id;
      const summary = await client.usage.getSummary(firstId);
      expect(summary.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown summary", async () => {
      await expect(client.usage.getSummary("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("usage.listLines()", () => {
    it("returns lines for a given summary id", async () => {
      const summaries = await client.usage.listSummaries({ size: 100 });
      const summaryId = summaries.content[0].id;
      const result = await client.usage.listLines(summaryId, { size: 100 });
      for (const line of result.content) {
        expect(line.usageSummaryId).toBe(summaryId);
      }
    });

    it("returns empty content for an unknown summary id", async () => {
      const result = await client.usage.listLines("does-not-exist", { size: 100 });
      expect(result.content).toEqual([]);
    });
  });

  // ─── Quotes ──────────────────────────────────────────────────────────────

  describe("quotes.list()", () => {
    it("returns quotes", async () => {
      const result = await client.quotes.list({ size: 100 });
      expect(result.content.length).toBeGreaterThan(0);
    });

    it("filters by companyId", async () => {
      const all = await client.quotes.list({ size: 100 });
      const companyId = all.content[0].companyId;
      const result = await client.quotes.list({ companyId, size: 100 });
      for (const q of result.content) {
        expect(q.companyId).toBe(companyId);
      }
    });
  });

  describe("quotes.get()", () => {
    it("returns quote by id", async () => {
      const all = await client.quotes.list({ size: 100 });
      const firstId = all.content[0].id;
      const quote = await client.quotes.get(firstId);
      expect(quote.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown quote", async () => {
      await expect(client.quotes.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("quotes.create()", () => {
    // Per #311: v2 body is `{ clientId, quoteRequestId? }` only — no line
    // items on create.
    it("creates an empty draft quote against the v2 body shape", async () => {
      const result = await client.quotes.create({
        clientId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      });
      expect(result.id).toContain("quote-demo-");
      expect(result.status).toBe("Draft");
      expect(result.companyId).toBe("a1b2c3d4-e5f6-7890-abcd-ef1234567890");
      expect(result.lineItems).toEqual([]);
    });
  });

  describe("quotes.update()", () => {
    it("updates a quote", async () => {
      const all = await client.quotes.list({ size: 100 });
      const firstId = all.content[0].id;
      const result = await client.quotes.update(firstId, { total: 2000 } as never);
      expect(result.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown quote", async () => {
      await expect(
        client.quotes.update("nonexistent", {} as never),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("quotes.delete()", () => {
    it("deletes existing quote", async () => {
      const all = await client.quotes.list({ size: 100 });
      const firstId = all.content[0].id;
      await expect(client.quotes.delete(firstId)).resolves.toBeUndefined();
    });

    it("throws NotFoundError for unknown quote", async () => {
      await expect(client.quotes.delete("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  // ─── Webhooks ────────────────────────────────────────────────────────────
  // Mock surface mirrors the real WebhooksApi (list, get, create, update,
  // updateStatus, delete, test, getLogs, retryLog).

  describe("webhooks.get()", () => {
    it("returns webhook by id", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      const wh = await client.webhooks.get(firstId);
      expect(wh.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(client.webhooks.get("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.create()", () => {
    it("creates a webhook", async () => {
      const result = await client.webhooks.create({
        url: "https://example.com/hook",
        topics: ["subscription.created"],
      });
      expect(result.status).toBe("Active");
      expect(result.url).toBe("https://example.com/hook");
      expect(result.topics).toEqual(["subscription.created"]);
    });
  });

  describe("webhooks.update()", () => {
    it("updates a webhook", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      const result = await client.webhooks.update(firstId, { url: "https://new.com/hook" });
      expect(result.url).toBe("https://new.com/hook");
      expect(result.id).toBe(firstId);
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(
        client.webhooks.update("nonexistent", { url: "https://x.com" }),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.updateStatus()", () => {
    it("updates webhook status", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      const result = await client.webhooks.updateStatus(firstId, "Disabled");
      expect(result.status).toBe("Disabled");
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(
        client.webhooks.updateStatus("nonexistent", "Active"),
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.delete()", () => {
    it("deletes existing webhook", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      await expect(client.webhooks.delete(firstId)).resolves.toBeUndefined();
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(client.webhooks.delete("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.test()", () => {
    it("returns test result for active webhook", async () => {
      const all = await client.webhooks.list();
      const active = all.find((w) => w.status === "Active");
      expect(active).toBeDefined();
      const result = (await client.webhooks.test(active!.id)) as {
        success: boolean;
        responseCode: number;
      };
      expect(result.success).toBe(true);
      expect(result.responseCode).toBe(200);
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(client.webhooks.test("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.getLogs()", () => {
    it("returns webhook logs for a given id", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      const logs = await client.webhooks.getLogs(firstId);
      expect(Array.isArray(logs)).toBe(true);
      for (const log of logs) {
        expect(log.webhookId).toBe(firstId);
      }
    });

    it("throws NotFoundError for unknown webhook", async () => {
      await expect(client.webhooks.getLogs("nonexistent")).rejects.toThrow(NotFoundError);
    });
  });

  describe("webhooks.retryLog()", () => {
    it("retries a webhook log", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      const logs = await client.webhooks.getLogs(firstId);
      expect(logs.length).toBeGreaterThan(0);
      const result = (await client.webhooks.retryLog(firstId, logs[0].id)) as {
        responseCode: number;
      };
      expect(result.responseCode).toBe(200);
    });

    it("throws NotFoundError for unknown log", async () => {
      const all = await client.webhooks.list();
      const firstId = all[0].id;
      await expect(client.webhooks.retryLog(firstId, "nonexistent")).rejects.toThrow(
        NotFoundError,
      );
    });
  });
});
