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

function normalizeInvoiceItem(item: any): NormalizedInvoiceItem {
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

function normalizeSubscription(sub: any): NormalizedSubscription {
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

function matchKey(item: { subscriptionId?: string; companyId: string; productId?: string }): string {
  if (item.subscriptionId) return `sub:${item.subscriptionId}`;
  return `cp:${item.companyId}:${item.productId ?? ""}`;
}

export function auditInvoices(invoiceItems: any[], subscriptions: any[]): AuditReport {
  const normalizedInvoices = invoiceItems.map(normalizeInvoiceItem);
  const normalizedSubs = subscriptions.map(normalizeSubscription).filter((s) => s.status === "active");

  const subMap = new Map<string, NormalizedSubscription>();
  for (const sub of normalizedSubs) {
    subMap.set(matchKey(sub), sub);
  }

  const matchedSubKeys = new Set<string>();
  const discrepancies: AuditDiscrepancy[] = [];

  // Check each invoice item against subscriptions
  for (const inv of normalizedInvoices) {
    const key = matchKey(inv);
    const sub = subMap.get(key);

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

    matchedSubKeys.add(key);

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
    const key = matchKey(sub);
    if (!matchedSubKeys.has(key) && !normalizedInvoices.some((inv) => matchKey(inv) === key)) {
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
