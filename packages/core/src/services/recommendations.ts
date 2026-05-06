// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import type { Subscription } from "../api/types.js";
import { subscriptionMrr } from "./analytics.js";

// ─── Product Categories ─────────────────────────────────────────────────────
// Maps keyword patterns in product names to categories.
// A product can belong to multiple categories.

export type ProductCategory =
  | "productivity"
  | "email"
  | "security"
  | "endpoint_protection"
  | "identity"
  | "backup"
  | "cloud_infrastructure";

interface CategoryRule {
  category: ProductCategory;
  patterns: RegExp[];
}

const CATEGORY_RULES: CategoryRule[] = [
  {
    category: "productivity",
    patterns: [/microsoft 365/i, /office 365/i, /google workspace/i, /m365/i],
  },
  {
    category: "email",
    patterns: [/exchange online/i, /mimecast/i, /proofpoint/i, /barracuda.*email/i],
  },
  {
    category: "security",
    patterns: [/defender/i, /sentinel/i, /crowdstrike/i, /sophos/i, /bitdefender/i, /kaspersky/i, /norton/i, /webroot/i],
  },
  {
    category: "endpoint_protection",
    patterns: [/defender/i, /sentinel/i, /crowdstrike/i, /sophos.*endpoint/i, /bitdefender/i, /webroot/i],
  },
  {
    category: "identity",
    patterns: [/azure ad/i, /entra/i, /okta/i, /duo/i, /jumpcloud/i, /conditional access/i],
  },
  {
    category: "backup",
    patterns: [/acronis/i, /datto/i, /veeam/i, /backup/i, /arcserve/i, /carbonite/i, /axcient/i],
  },
  {
    category: "cloud_infrastructure",
    patterns: [/azure plan/i, /aws/i, /amazon web services/i, /google cloud/i],
  },
];

export const ALL_CATEGORIES: ProductCategory[] = [
  "productivity",
  "email",
  "security",
  "endpoint_protection",
  "identity",
  "backup",
  "cloud_infrastructure",
];

export function categorizeProduct(productName: string): ProductCategory[] {
  const categories: ProductCategory[] = [];
  for (const rule of CATEGORY_RULES) {
    if (rule.patterns.some((p) => p.test(productName))) {
      categories.push(rule.category);
    }
  }
  return categories;
}

// ─── Cross-sell Rules ───────────────────────────────────────────────────────
// "If a company has X but NOT Y, recommend Y"

interface CrossSellRule {
  ifHas: ProductCategory;
  butMissing: ProductCategory;
  reason: string;
  priority: "high" | "medium" | "low";
  suggestedProducts: string[]; // Product name keywords to search for
  /** Generic action title when no orderable product is available */
  genericTitle: string;
}

const CROSS_SELL_RULES: CrossSellRule[] = [
  {
    ifHas: "productivity",
    butMissing: "backup",
    reason: "No backup solution — SaaS data is not backed up by default. A single accidental deletion or ransomware event could cause permanent data loss.",
    priority: "high",
    suggestedProducts: ["AvePoint Cloud Backup for Microsoft 365", "Datto SaaS Protection", "Veeam Backup"],
    genericTitle: "Consider adding a backup solution",
  },
  {
    ifHas: "productivity",
    butMissing: "endpoint_protection",
    reason: "No endpoint protection — users with productivity suites are high-value targets for phishing and malware.",
    priority: "high",
    suggestedProducts: ["Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]", "CrowdStrike MSSP Complete Defend"],
    genericTitle: "Consider adding endpoint protection",
  },
  {
    ifHas: "productivity",
    butMissing: "identity",
    reason: "No identity management — without MFA and conditional access, compromised credentials are the #1 attack vector.",
    priority: "high",
    suggestedProducts: ["Microsoft Entra ID P1 [New Commerce Experience]", "JumpCloud"],
    genericTitle: "Consider adding identity management",
  },
  {
    ifHas: "email",
    butMissing: "security",
    reason: "Email without advanced security — email is the primary attack surface. Native filtering misses sophisticated threats.",
    priority: "medium",
    suggestedProducts: ["Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]", "Mimecast"],
    genericTitle: "Consider adding email security",
  },
  {
    ifHas: "cloud_infrastructure",
    butMissing: "backup",
    reason: "Cloud infrastructure without backup — cloud provider SLAs don't cover data loss from user error or ransomware.",
    priority: "medium",
    suggestedProducts: ["AvePoint Cloud Backup for Microsoft 365", "Veeam Backup"],
    genericTitle: "Consider adding a backup solution",
  },
  {
    ifHas: "cloud_infrastructure",
    butMissing: "security",
    reason: "Cloud infrastructure without security — workloads need threat detection and compliance monitoring.",
    priority: "medium",
    suggestedProducts: ["CrowdStrike MSSP Complete Defend", "SentinelOne Singularity Complete"],
    genericTitle: "Consider adding a security solution",
  },
  {
    ifHas: "security",
    butMissing: "backup",
    reason: "Security without backup — even with endpoint protection, ransomware recovery requires clean backups.",
    priority: "low",
    suggestedProducts: ["AvePoint Cloud Backup for Microsoft 365", "Datto SaaS Protection"],
    genericTitle: "Consider adding a backup solution",
  },
];

// ─── Seat Gap Detection ─────────────────────────────────────────────────────
// If a company has 85 M365 seats but only 20 backup seats, flag the gap.

interface SeatGap {
  baseProduct: string;
  baseQuantity: number;
  gapProduct: string;
  gapProductId: string;
  gapQuantity: number;
  missingSeats: number;
  category: ProductCategory;
}

function findSeatGaps(companySubs: SubscriptionInput[]): SeatGap[] {
  const gaps: SeatGap[] = [];

  const activeSubs = companySubs.filter((s) => s.status === "Active");
  if (activeSubs.length < 2) return gaps;

  // Group subs by category — only compare within the same category
  const byCategory = new Map<ProductCategory, SubscriptionInput[]>();
  for (const sub of activeSubs) {
    const cats = categorizeProduct(sub.productName ?? "");
    for (const cat of cats) {
      const list = byCategory.get(cat) ?? [];
      list.push(sub);
      byCategory.set(cat, list);
    }
  }

  // For each category with multiple products, find seat gaps
  for (const [category, catSubs] of byCategory) {
    if (catSubs.length < 2) continue;
    const sorted = [...catSubs].sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0));
    const primary = sorted[0];
    const primaryQty = primary.quantity ?? 0;
    if (primaryQty < 10) continue; // Don't flag tiny deployments

    for (const sub of sorted.slice(1)) {
      const subQty = sub.quantity ?? 0;
      const ratio = subQty / primaryQty;
      const missing = primaryQty - subQty;
      // Flag if coverage is less than 50% and at least 10 seats missing
      if (ratio < 0.5 && missing >= 10) {
        gaps.push({
          baseProduct: primary.productName ?? "",
          baseQuantity: primaryQty,
          gapProduct: sub.productName ?? "",
          gapProductId: sub.productId ?? "",
          gapQuantity: subQty,
          missingSeats: missing,
          category,
        });
      }
    }
  }

  return gaps;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Loose input shape accepted by the recommendations engine. We use
 * `Omit<Partial<Subscription>, "status" | "billingTerm"> & {...}` rather than
 * a plain intersection so callers can pass rows whose `status` /
 * `billingTerm` are wider strings (e.g. demo-data rows or hand-built
 * objects from a script) without having to satisfy the strict literal
 * unions on `Subscription`.
 */
type SubscriptionInput = Omit<Partial<Subscription>, "status" | "billingTerm"> & {
  companyId?: string;
  productName?: string;
  companyName?: string;
  quantity?: number;
  status?: string;
  productId?: string;
  price?: number;
  billingTerm?: string;
};

export interface Recommendation {
  companyId: string;
  companyName: string;
  type: "cross_sell" | "seat_gap";
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  suggestedProducts: string[];
  /** The exact CLI command to execute this recommendation */
  orderCommand: string | null;
  /** Whether the recommended product is available and orderable in the Pax8 catalog */
  productAvailable: boolean;
  /** Current MRR for this company */
  currentMrr: number;
  /** Estimated additional MRR if recommendation is adopted */
  estimatedMrrUplift: number | null;
  /** How many seats the recommendation targets */
  targetSeats: number | null;
  /** Indicates the MRR uplift estimate is an upper bound, not a forecast */
  estimateType: "upper_bound";
}

export interface RecommendationReport {
  recommendations: Recommendation[];
  totalCompanies: number;
  companiesWithGaps: number;
  estimatedTotalMrrUplift: number;
  /** Suggested products that could not be matched to any catalog product */
  unmatchedProducts: string[];
}

export interface CompanyCoverage {
  companyId: string;
  companyName: string;
  coveredCategories: ProductCategory[];
  missingCategories: ProductCategory[];
  coverage: string; // e.g. "3/7"
  estimatedUplift: number;
}

/**
 * Compute portfolio coverage per company: which of the 7 product categories
 * each company already has, which are missing, and estimated MRR uplift from
 * filling the gaps (using the recommendations engine).
 */
export function getPortfolioCoverage(
  subscriptions: SubscriptionInput[],
  recommendations?: Recommendation[],
): Map<string, CompanyCoverage> {
  const result = new Map<string, CompanyCoverage>();

  // Group active subs by company
  const byCompany = new Map<string, SubscriptionInput[]>();
  for (const sub of subscriptions) {
    if (sub.status !== "Active" || !sub.companyId) continue;
    const list = byCompany.get(sub.companyId) ?? [];
    list.push(sub);
    byCompany.set(sub.companyId, list);
  }

  // Aggregate recommendations uplift per company
  const upliftByCompany = new Map<string, number>();
  if (recommendations) {
    for (const rec of recommendations) {
      const existing = upliftByCompany.get(rec.companyId) ?? 0;
      upliftByCompany.set(rec.companyId, existing + (rec.estimatedMrrUplift ?? 0));
    }
  }

  for (const [companyId, subs] of byCompany) {
    const companyName = subs[0]?.companyName ?? companyId;
    const covered = new Set<ProductCategory>();
    for (const sub of subs) {
      const cats = categorizeProduct(sub.productName ?? "");
      for (const c of cats) covered.add(c);
    }

    const coveredCategories = ALL_CATEGORIES.filter((c) => covered.has(c));
    const missingCategories = ALL_CATEGORIES.filter((c) => !covered.has(c));

    result.set(companyId, {
      companyId,
      companyName,
      coveredCategories,
      missingCategories,
      coverage: `${coveredCategories.length}/${ALL_CATEGORIES.length}`,
      estimatedUplift: Number((upliftByCompany.get(companyId) ?? 0).toFixed(2)),
    });
  }

  return result;
}

export function getRecommendations(
  subscriptions: SubscriptionInput[],
  products?: Array<{ id: string; name: string; vendorName?: string; pricing?: Array<{ billingTerm: string; suggestedRetailPrice: number }> }>,
  companies?: Array<{ id: string; name: string }>,
): RecommendationReport {
  // Group subscriptions by company
  const byCompany = new Map<string, SubscriptionInput[]>();
  for (const sub of subscriptions) {
    if (sub.status !== "Active" || !sub.companyId) continue;
    const list = byCompany.get(sub.companyId) ?? [];
    list.push(sub);
    byCompany.set(sub.companyId, list);
  }

  // Build product price lookup for MRR uplift estimates
  // Source 1: product catalog pricing (if available)
  const productPriceMap = new Map<string, number>();
  if (products) {
    for (const p of products) {
      const monthlyRate = p.pricing?.find((r) => r.billingTerm === "Monthly");
      if (monthlyRate) {
        productPriceMap.set(p.name.toLowerCase(), monthlyRate.suggestedRetailPrice);
      }
    }
  }
  // Source 2: actual subscription prices (always available, more accurate)
  for (const sub of subscriptions) {
    if (sub.status !== "Active") continue;
    const name = (sub.productName ?? "").toLowerCase();
    const price = sub.price ?? 0;
    if (name && price > 0 && !productPriceMap.has(name)) {
      productPriceMap.set(name, price);
    }
  }

  // Build a "peer product" lookup: for each category, find the most popular
  // product (by company count) already in use across the account.
  // Skip charity/non-profit/GCC/education SKUs as they aren't orderable for commercial customers.
  const RESTRICTED_PATTERNS = /non-profit|charity|gcc|education|faculty|student|government|\bAOS\b/i;

  const categoryProducts = new Map<ProductCategory, { productId: string; productName: string; count: number }>();
  for (const [, companySubs] of byCompany) {
    const seen = new Set<string>(); // dedupe per company
    for (const sub of companySubs) {
      const name = sub.productName ?? "";
      const pid = sub.productId ?? "";
      if (!pid || seen.has(pid)) continue;
      if (RESTRICTED_PATTERNS.test(name)) continue; // Skip restricted SKUs
      seen.add(pid);
      const cats = categorizeProduct(name);
      for (const cat of cats) {
        const existing = categoryProducts.get(cat);
        if (!existing || existing.count < 1) {
          categoryProducts.set(cat, { productId: pid, productName: name, count: (existing?.count ?? 0) + 1 });
        } else {
          existing.count++;
        }
      }
    }
  }

  const recommendations: Recommendation[] = [];
  const unmatchedProducts = new Set<string>();

  for (const [companyId, subs] of byCompany) {
    const companyName = subs[0]?.companyName ?? companyId;

    // Determine what categories this company already has
    const hasCategories = new Set<ProductCategory>();
    for (const sub of subs) {
      const cats = categorizeProduct(sub.productName ?? "");
      for (const c of cats) hasCategories.add(c);
    }

    // Calculate current MRR
    let currentMrr = 0;
    for (const sub of subs) {
      currentMrr += subscriptionMrr(sub.price ?? 0, sub.quantity ?? 0, sub.billingTerm ?? "Monthly");
    }

    // Check cross-sell rules
    for (const rule of CROSS_SELL_RULES) {
      if (hasCategories.has(rule.ifHas) && !hasCategories.has(rule.butMissing)) {
        // Estimate MRR uplift based on primary seat count
        const primaryQty = Math.max(...subs.map((s) => s.quantity ?? 0));
        let estimatedMrrUplift: number | null = null;
        const suggestedName = rule.suggestedProducts[0];
        if (suggestedName) {
          const price = productPriceMap.get(suggestedName.toLowerCase());
          if (price) {
            estimatedMrrUplift = price * primaryQty;
          }
        }

        // Find a matching product ID for the order command
        // Filter out restricted SKUs (non-profit, charity, GCC, education)
        let matchedProductId: string | null = null;
        const orderableProducts = products?.filter((p) => !RESTRICTED_PATTERNS.test(p.name));
        if (orderableProducts && suggestedName) {
          const sugLower = suggestedName.toLowerCase();
          // Try exact substring match first
          let match = orderableProducts.find((p) =>
            p.name.toLowerCase().includes(sugLower) ||
            sugLower.includes(p.name.toLowerCase())
          );
          // Fall back to keyword matching (all significant words must appear)
          if (!match) {
            const keywords = sugLower.split(/\s+/).filter((w) => w.length > 2);
            match = orderableProducts.find((p) => {
              const pLower = p.name.toLowerCase();
              return keywords.every((kw) => pLower.includes(kw));
            });
          }
          if (match) matchedProductId = match.id;
        }

        // Fall back to peer product if catalog match failed
        let resolvedProductName = suggestedName ?? rule.butMissing.replace(/_/g, " ");
        if (!matchedProductId) {
          const peer = categoryProducts.get(rule.butMissing);
          if (peer && peer.productId) {
            matchedProductId = peer.productId;
            resolvedProductName = peer.productName;
          }
        }

        // If initial price lookup failed but we resolved a real product name, retry lookup
        if (!estimatedMrrUplift && resolvedProductName) {
          const resolvedPrice = productPriceMap.get(resolvedProductName.toLowerCase());
          if (resolvedPrice) {
            estimatedMrrUplift = resolvedPrice * primaryQty;
          }
        }

        const productAvailable = matchedProductId !== null;
        if (!productAvailable && suggestedName) {
          unmatchedProducts.add(suggestedName);
        }
        const orderCommand = matchedProductId
          ? `pax8 orders create --company "${companyName}" --product ${matchedProductId} --quantity ${primaryQty}`
          : null;

        // Demote to medium priority when the product isn't available/orderable
        const effectivePriority: "high" | "medium" | "low" = productAvailable
          ? rule.priority
          : rule.priority === "high"
            ? "medium"
            : rule.priority;

        // Use generic title when product isn't available; specific title when it is
        const title = productAvailable
          ? `Add ${resolvedProductName} for ${companyName}`
          : `${rule.genericTitle} for ${companyName}`;

        recommendations.push({
          companyId,
          companyName,
          type: "cross_sell",
          priority: effectivePriority,
          title,
          reason: rule.reason,
          suggestedProducts: [resolvedProductName, ...rule.suggestedProducts.slice(1)],
          orderCommand,
          productAvailable,
          currentMrr: Number(currentMrr.toFixed(2)),
          estimatedMrrUplift: estimatedMrrUplift !== null ? Number(estimatedMrrUplift.toFixed(2)) : null,
          targetSeats: primaryQty,
          estimateType: "upper_bound",
        });
      }
    }

    // Check seat gaps
    const gaps = findSeatGaps(subs);
    for (const gap of gaps) {
      const price = productPriceMap.get(gap.gapProduct.toLowerCase());
      const estimatedMrrUplift = price ? price * gap.missingSeats : null;

      // For seat gaps, use the product ID directly from the subscription
      const orderCommand = gap.gapProductId
        ? `pax8 orders create --company "${companyName}" --product ${gap.gapProductId} --quantity ${gap.missingSeats}`
        : null;

      recommendations.push({
        companyId,
        companyName,
        type: "seat_gap",
        priority: gap.missingSeats > 20 ? "high" : "medium",
        title: `${gap.missingSeats} uncovered seats: ${gap.gapProduct} (${gap.gapQuantity}/${gap.baseQuantity})`,
        reason: `${gap.baseProduct} covers ${gap.baseQuantity} seats but ${gap.gapProduct} only covers ${gap.gapQuantity}. ${gap.missingSeats} seats are unprotected.`,
        suggestedProducts: [gap.gapProduct],
        orderCommand,
        productAvailable: true, // seat gaps reference products already in use
        currentMrr: Number(currentMrr.toFixed(2)),
        estimatedMrrUplift: estimatedMrrUplift !== null ? Number(estimatedMrrUplift.toFixed(2)) : null,
        targetSeats: gap.missingSeats,
        estimateType: "upper_bound",
      });
    }
  }

  // Flag companies with zero active subscriptions
  if (companies) {
    for (const company of companies) {
      if (!byCompany.has(company.id)) {
        recommendations.push({
          companyId: company.id,
          companyName: company.name,
          type: "cross_sell",
          priority: "high",
          title: `No active subscriptions for ${company.name}`,
          reason: "This customer has no active subscriptions. Consider reaching out to discuss their needs.",
          suggestedProducts: [],
          orderCommand: null,
          productAvailable: false,
          currentMrr: 0,
          estimatedMrrUplift: null,
          targetSeats: null,
          estimateType: "upper_bound",
        });
      }
    }
  }

  // Deduplicate: if the same company + missing category appears from multiple rules, keep highest priority
  const seen = new Set<string>();
  const deduped: Recommendation[] = [];
  for (const rec of recommendations) {
    // For cross-sell, dedupe by company + suggested category (from title)
    // For seat_gap, dedupe by company + product
    const key = `${rec.companyId}:${rec.type}:${rec.title}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(rec);
    }
  }

  // Sort: high priority first, then by estimated MRR uplift descending
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  deduped.sort((a, b) => {
    const pDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
    if (pDiff !== 0) return pDiff;
    return (b.estimatedMrrUplift ?? 0) - (a.estimatedMrrUplift ?? 0);
  });

  // Count total companies: union of companies with subs + companies passed in
  const allCompanyIds = new Set(byCompany.keys());
  if (companies) {
    for (const c of companies) allCompanyIds.add(c.id);
  }

  const companiesWithGaps = new Set(deduped.map((r) => r.companyId)).size;
  const estimatedTotalMrrUplift = Number(deduped.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0).toFixed(2));

  return {
    recommendations: deduped,
    totalCompanies: allCompanyIds.size,
    companiesWithGaps,
    estimatedTotalMrrUplift,
    unmatchedProducts: [...unmatchedProducts],
  };
}
