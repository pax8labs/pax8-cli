import type { Subscription } from "../api/types.js";

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

function categorizeProduct(productName: string): ProductCategory[] {
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
}

const CROSS_SELL_RULES: CrossSellRule[] = [
  {
    ifHas: "productivity",
    butMissing: "backup",
    reason: "No backup solution — SaaS data is not backed up by default. A single accidental deletion or ransomware event could cause permanent data loss.",
    priority: "high",
    suggestedProducts: ["Acronis Cyber Backup", "Datto SaaS Protection", "Veeam Backup"],
  },
  {
    ifHas: "productivity",
    butMissing: "endpoint_protection",
    reason: "No endpoint protection — users with productivity suites are high-value targets for phishing and malware.",
    priority: "high",
    suggestedProducts: ["Microsoft Defender for Business", "SentinelOne Singularity"],
  },
  {
    ifHas: "productivity",
    butMissing: "identity",
    reason: "No identity management — without MFA and conditional access, compromised credentials are the #1 attack vector.",
    priority: "high",
    suggestedProducts: ["Azure AD Premium P1", "JumpCloud"],
  },
  {
    ifHas: "email",
    butMissing: "security",
    reason: "Email without advanced security — email is the primary attack surface. Native filtering misses sophisticated threats.",
    priority: "medium",
    suggestedProducts: ["Microsoft Defender for Business", "Mimecast"],
  },
  {
    ifHas: "cloud_infrastructure",
    butMissing: "backup",
    reason: "Cloud infrastructure without backup — cloud provider SLAs don't cover data loss from user error or ransomware.",
    priority: "medium",
    suggestedProducts: ["Acronis Cyber Backup", "Veeam Backup"],
  },
  {
    ifHas: "cloud_infrastructure",
    butMissing: "security",
    reason: "Cloud infrastructure without security — workloads need threat detection and compliance monitoring.",
    priority: "medium",
    suggestedProducts: ["SentinelOne Singularity", "CrowdStrike Falcon"],
  },
  {
    ifHas: "security",
    butMissing: "backup",
    reason: "Security without backup — even with endpoint protection, ransomware recovery requires clean backups.",
    priority: "low",
    suggestedProducts: ["Acronis Cyber Backup", "Datto SaaS Protection"],
  },
];

// ─── Seat Gap Detection ─────────────────────────────────────────────────────
// If a company has 85 M365 seats but only 20 backup seats, flag the gap.

interface SeatGap {
  baseProduct: string;
  baseQuantity: number;
  gapProduct: string;
  gapQuantity: number;
  missingSeats: number;
  category: ProductCategory;
}

function findSeatGaps(companySubs: SubscriptionInput[]): SeatGap[] {
  const gaps: SeatGap[] = [];

  // Find the "primary" subscription (highest seat count, typically productivity)
  const activeSubs = companySubs.filter((s) => s.status === "Active");
  if (activeSubs.length < 2) return gaps;

  const sorted = [...activeSubs].sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0));
  const primary = sorted[0];
  const primaryQty = primary.quantity ?? 0;
  if (primaryQty === 0) return gaps;

  for (const sub of sorted.slice(1)) {
    const subQty = sub.quantity ?? 0;
    const ratio = subQty / primaryQty;
    // Flag if coverage is less than 80% of primary seats
    if (ratio < 0.8 && primaryQty - subQty >= 5) {
      const categories = categorizeProduct(sub.productName ?? "");
      gaps.push({
        baseProduct: primary.productName ?? "",
        baseQuantity: primaryQty,
        gapProduct: sub.productName ?? "",
        gapQuantity: subQty,
        missingSeats: primaryQty - subQty,
        category: categories[0] ?? "security",
      });
    }
  }

  return gaps;
}

// ─── Public API ─────────────────────────────────────────────────────────────

type SubscriptionInput = Partial<Subscription> & {
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
  /** Current MRR for this company */
  currentMrr: number;
  /** Estimated additional MRR if recommendation is adopted */
  estimatedMrrUplift: number | null;
  /** How many seats the recommendation targets */
  targetSeats: number | null;
}

export interface RecommendationReport {
  recommendations: Recommendation[];
  totalCompanies: number;
  companiesWithGaps: number;
  estimatedTotalMrrUplift: number;
}

export function getRecommendations(
  subscriptions: SubscriptionInput[],
  products?: Array<{ id: string; name: string; vendorName?: string; pricing?: Array<{ billingTerm: string; suggestedRetailPrice: number }> }>,
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
  const productPriceMap = new Map<string, number>();
  if (products) {
    for (const p of products) {
      const monthlyRate = p.pricing?.find((r) => r.billingTerm === "Monthly");
      if (monthlyRate) {
        productPriceMap.set(p.name.toLowerCase(), monthlyRate.suggestedRetailPrice);
      }
    }
  }

  const recommendations: Recommendation[] = [];

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
      const price = sub.price ?? 0;
      const qty = sub.quantity ?? 0;
      const term = sub.billingTerm ?? "Monthly";
      currentMrr += term.toLowerCase().includes("annual") ? (price * qty) / 12 : price * qty;
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
        let matchedProductId: string | null = null;
        if (products && suggestedName) {
          const match = products.find((p) =>
            p.name.toLowerCase().includes(suggestedName.toLowerCase()) ||
            suggestedName.toLowerCase().includes(p.name.toLowerCase())
          );
          if (match) matchedProductId = match.id;
        }

        const orderCommand = matchedProductId
          ? `pax8 orders create --company ${companyId} --product ${matchedProductId} --quantity ${primaryQty}`
          : null;

        recommendations.push({
          companyId,
          companyName,
          type: "cross_sell",
          priority: rule.priority,
          title: `Add ${rule.butMissing.replace(/_/g, " ")} for ${companyName}`,
          reason: rule.reason,
          suggestedProducts: rule.suggestedProducts,
          orderCommand,
          currentMrr,
          estimatedMrrUplift,
          targetSeats: primaryQty,
        });
      }
    }

    // Check seat gaps
    const gaps = findSeatGaps(subs);
    for (const gap of gaps) {
      const price = productPriceMap.get(gap.gapProduct.toLowerCase());
      const estimatedMrrUplift = price ? price * gap.missingSeats : null;

      // Find product ID for the gap product
      const matchedProduct = products?.find((p) =>
        p.name.toLowerCase() === gap.gapProduct.toLowerCase()
      );

      // For seat gaps, we'd update the existing subscription, not create a new order
      // But for simplicity, we suggest an order for the missing seats
      const orderCommand = matchedProduct
        ? `pax8 orders create --company ${companyId} --product ${matchedProduct.id} --quantity ${gap.missingSeats}`
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
        currentMrr,
        estimatedMrrUplift,
        targetSeats: gap.missingSeats,
      });
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

  const companiesWithGaps = new Set(deduped.map((r) => r.companyId)).size;
  const estimatedTotalMrrUplift = deduped.reduce((sum, r) => sum + (r.estimatedMrrUplift ?? 0), 0);

  return {
    recommendations: deduped,
    totalCompanies: byCompany.size,
    companiesWithGaps,
    estimatedTotalMrrUplift,
  };
}
