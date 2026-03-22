import type { InvoiceItem, Subscription } from "../api/types.js";

/** The subset of InvoiceItem fields used by the invoice auditor. */
type AuditInvoiceItemInput = Partial<InvoiceItem> & {
  companyName?: string;
  productName?: string;
  price?: number;
};

/** The subset of Subscription fields used by the invoice auditor. */
type AuditSubscriptionInput = Partial<Subscription> & {
  subscriptionId?: string;
  unitPrice?: number;
};

export interface AuditDiscrepancy {
  companyId: string;
  companyName: string;
  productName: string;
  invoicedQuantity: number;
  activeQuantity: number;
  delta: number; // positive = overcharge, negative = undercharge
  dollarImpact: number;
  type: "overcharge" | "undercharge" | "missing" | "unexpected";
}

export interface AuditReport {
  discrepancies: AuditDiscrepancy[];
  totalOvercharge: number;
  totalUndercharge: number;
  netImpact: number;
  itemsAudited: number;
}

interface NormalizedInvoiceItem {
  subscriptionId?: string;
  companyId: string;
  companyName: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
}

interface NormalizedSubscription {
  subscriptionId: string;
  companyId: string;
  companyName: string;
  productId?: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  status: string;
}

function normalizeInvoiceItem(item: AuditInvoiceItemInput): NormalizedInvoiceItem {
  return {
    subscriptionId: item.subscriptionId,
    companyId: item.companyId ?? "",
    companyName: item.companyName ?? "",
    productId: item.productId,
    productName: item.productName ?? "",
    quantity: item.quantity ?? 0,
    unitPrice: item.unitPrice ?? item.price ?? 0,
  };
}

function normalizeSubscription(sub: AuditSubscriptionInput): NormalizedSubscription {
  return {
    subscriptionId: sub.id ?? sub.subscriptionId ?? "",
    companyId: sub.companyId ?? "",
    companyName: sub.companyName ?? "",
    productId: sub.productId,
    productName: sub.productName ?? "",
    quantity: sub.quantity ?? 0,
    unitPrice: sub.price ?? sub.unitPrice ?? 0,
    status: (sub.status ?? "").toLowerCase(),
  };
}

function subKey(subscriptionId: string): string {
  return `sub:${subscriptionId}`;
}

function cpKey(companyId: string, productId?: string): string {
  return `cp:${companyId}:${productId ?? ""}`;
}

export function auditInvoices(invoiceItems: AuditInvoiceItemInput[], subscriptions: AuditSubscriptionInput[]): AuditReport {
  const normalizedInvoices = invoiceItems.map(normalizeInvoiceItem);
  const normalizedSubs = subscriptions.map(normalizeSubscription).filter((s) => s.status === "active");

  // Index each subscription under both its sub: key and cp: key so that
  // invoice items can match regardless of whether they carry a subscriptionId.
  const subMap = new Map<string, NormalizedSubscription>();
  for (const sub of normalizedSubs) {
    if (sub.subscriptionId) {
      subMap.set(subKey(sub.subscriptionId), sub);
    }
    subMap.set(cpKey(sub.companyId, sub.productId), sub);
  }

  const matchedSubs = new Set<NormalizedSubscription>();
  const discrepancies: AuditDiscrepancy[] = [];

  // Check each invoice item against subscriptions
  for (const inv of normalizedInvoices) {
    // Try sub: key first (most specific), then fall back to cp: key
    const sub =
      (inv.subscriptionId ? subMap.get(subKey(inv.subscriptionId)) : undefined) ??
      subMap.get(cpKey(inv.companyId, inv.productId));

    if (!sub) {
      // Invoiced but no active subscription
      discrepancies.push({
        companyId: inv.companyId,
        companyName: inv.companyName,
        productName: inv.productName,
        invoicedQuantity: inv.quantity,
        activeQuantity: 0,
        delta: inv.quantity,
        dollarImpact: inv.quantity * inv.unitPrice,
        type: "unexpected",
      });
      continue;
    }

    matchedSubs.add(sub);

    const delta = inv.quantity - sub.quantity;
    if (delta === 0) continue;

    const unitPrice = inv.unitPrice || sub.unitPrice;
    discrepancies.push({
      companyId: inv.companyId || sub.companyId,
      companyName: inv.companyName || sub.companyName,
      productName: inv.productName || sub.productName,
      invoicedQuantity: inv.quantity,
      activeQuantity: sub.quantity,
      delta,
      dollarImpact: delta * unitPrice,
      type: delta > 0 ? "overcharge" : "undercharge",
    });
  }

  // Check for active subscriptions not invoiced
  for (const sub of normalizedSubs) {
    if (!matchedSubs.has(sub)) {
      discrepancies.push({
        companyId: sub.companyId,
        companyName: sub.companyName,
        productName: sub.productName,
        invoicedQuantity: 0,
        activeQuantity: sub.quantity,
        delta: -sub.quantity,
        dollarImpact: -(sub.quantity * sub.unitPrice),
        type: "missing",
      });
    }
  }

  const totalOvercharge = discrepancies
    .filter((d) => d.dollarImpact > 0)
    .reduce((sum, d) => sum + d.dollarImpact, 0);

  const totalUndercharge = discrepancies
    .filter((d) => d.dollarImpact < 0)
    .reduce((sum, d) => sum + Math.abs(d.dollarImpact), 0);

  return {
    discrepancies,
    totalOvercharge,
    totalUndercharge,
    netImpact: totalOvercharge - totalUndercharge,
    itemsAudited: normalizedInvoices.length + normalizedSubs.length,
  };
}
