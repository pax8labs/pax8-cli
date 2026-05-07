// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { InvoiceItem, Subscription } from "../api/types.js";

/** The subset of InvoiceItem fields used by the invoice auditor. */
type AuditInvoiceItemInput = Partial<InvoiceItem> & {
  companyName?: string;
  productName?: string;
  /**
   * Legacy alias for the canonical `price` field. Kept on the input shape so
   * callers still passing pre-#273 invoice items (with `unitPrice`) continue
   * to work. New code should use `price` (the public API field name).
   */
  unitPrice?: number;
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
    // Canonical first (`price` matches the public API after #273); fall back
    // to `unitPrice` for any callers still passing the legacy shape.
    unitPrice: item.price ?? item.unitPrice ?? 0,
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

  // Index each subscription under its sub: key for exact matching,
  // and aggregate quantities under the cp: key so that multiple active
  // subscriptions for the same company+product are summed correctly.
  const subByIdMap = new Map<string, NormalizedSubscription>();
  const subByCpMap = new Map<string, NormalizedSubscription>();
  // Track which individual subs are covered by a cp: key so we can
  // mark them as matched when the aggregated entry is matched.
  const cpGroupMembers = new Map<string, NormalizedSubscription[]>();

  for (const sub of normalizedSubs) {
    if (sub.subscriptionId) {
      subByIdMap.set(subKey(sub.subscriptionId), sub);
    }
    const ck = cpKey(sub.companyId, sub.productId);
    const existing = subByCpMap.get(ck);
    if (existing) {
      // Aggregate: sum quantities, keep the first entry's metadata
      existing.quantity += sub.quantity;
    } else {
      // Store a copy so aggregation doesn't mutate the original
      subByCpMap.set(ck, { ...sub });
    }
    // Track group members for matched-sub bookkeeping
    let members = cpGroupMembers.get(ck);
    if (!members) {
      members = [];
      cpGroupMembers.set(ck, members);
    }
    members.push(sub);
  }

  const matchedSubs = new Set<NormalizedSubscription>();
  const discrepancies: AuditDiscrepancy[] = [];

  // Check each invoice item against subscriptions
  for (const inv of normalizedInvoices) {
    // Try sub: key first (most specific), then fall back to cp: key
    // which has aggregated quantities across all matching subscriptions.
    const sub =
      (inv.subscriptionId ? subByIdMap.get(subKey(inv.subscriptionId)) : undefined) ??
      subByCpMap.get(cpKey(inv.companyId, inv.productId));

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

    // Mark all individual subs in the cp: group as matched
    const ck = cpKey(inv.companyId, inv.productId);
    const members = cpGroupMembers.get(ck);
    if (members) {
      for (const m of members) matchedSubs.add(m);
    } else {
      matchedSubs.add(sub);
    }

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
