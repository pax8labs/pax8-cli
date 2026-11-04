// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

/**
 * Static glossary backing `pax8 explain <term>` (#656 — UXR F8).
 *
 * The v1 term list is drawn from wording that already appears in
 * user-facing CLI output (table headers, --json field names, help
 * blocks). Terms that are internal-only or purely aspirational stay
 * out — they can join in follow-ups once someone encounters them.
 * SME copy review lands via the `needs-sme-review` label on #656.
 *
 * **Append-only in spirit, but not enforced.** New entries welcome;
 * removing or renaming a canonical `term` is a breaking change for
 * scripts that do `pax8 explain <slug> --json`, so treat it like a
 * public API change.
 */

export type GlossaryCategory =
  | "recommendation"
  | "subscription"
  | "billing"
  | "product"
  | "operational";

export interface GlossaryEntry {
  /** Canonical kebab-case slug. Lowercase, hyphen-separated. */
  term: string;
  /**
   * Alternate forms that resolve to this entry. Aliases are matched
   * after the same normalization the lookup applies to user input
   * (lowercase, `_` → `-`, whitespace → `-`).
   */
  aliases?: readonly string[];
  category: GlossaryCategory;
  /** One sentence. Always shown. */
  short: string;
  /**
   * Additional context (1–3 sentences). Shown in the default text
   * layout below `short`. Optional — some terms don't need it.
   */
  detail?: string;
  /** Other canonical slugs the reader may want to look up next. */
  seeAlso?: readonly string[];
  /**
   * Short human hint at where this term shows up in the CLI.
   * Not a URL — reads like a breadcrumb.
   */
  reference?: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "seat-gap",
    aliases: ["seat gap", "seatgap", "seat_gap", "mismatched-seats", "mismatched seats"],
    category: "recommendation",
    short:
      "A cross-product seat mismatch surfaced as a recommendation — e.g. 100 email seats but only 30 backup seats.",
    detail:
      "The CLI's own heuristic, not the same as Pax8's canonical Seat Utilization metric (which measures assigned-vs-purchased seats within a single product). Seat gaps typically map to an Upsell opportunity on the OE five-type taxonomy.",
    seeAlso: ["cross-sell", "opportunity-type", "recommendation"],
    reference: "pax8 recommendations list",
  },
  {
    term: "cross-sell",
    aliases: ["cross_sell", "crosssell"],
    category: "recommendation",
    short:
      "A recommendation to add a product category the customer doesn't have yet.",
    detail:
      "In the recommendations JSON, `type: \"cross_sell\"` on an active-sub customer maps to Opportunity Explorer's Cross-sell; on a zero-sub customer it maps to Net-new (carried on `opportunityType`).",
    seeAlso: ["opportunity-type", "recommendation", "upsell"],
    reference: "pax8 recommendations list --json",
  },
  {
    term: "upsell",
    category: "recommendation",
    short:
      "An opportunity to expand what the customer already has — more seats or a higher tier of the same product.",
    detail:
      "One of the five Pax8 Opportunity Explorer types on `opportunityType`. In the CLI it's most commonly surfaced through seat-gap recommendations.",
    seeAlso: ["seat-gap", "opportunity-type", "cross-sell"],
    reference: "pax8 recommendations list --json",
  },
  {
    term: "add-on",
    aliases: ["addon", "add_on"],
    category: "recommendation",
    short:
      "A product designed to attach to an existing subscription — e.g. Defender for Microsoft 365.",
    detail:
      "One of the five OE opportunity types on `opportunityType`. Add-ons are still recommendations, just with a stronger prerequisite than pure cross-sell.",
    seeAlso: ["opportunity-type", "cross-sell"],
    reference: "pax8 recommendations list --json",
  },
  {
    term: "opportunity-type",
    aliases: ["opportunitytype", "opportunity type"],
    category: "recommendation",
    short:
      "Pax8 Opportunity Explorer's five-value taxonomy: Upsell, Cross-sell, Add-on, Upgrade, Net-new.",
    detail:
      "Carried on the `opportunityType` field in `recommendations list --json`. The legacy `type` field (`cross_sell` | `seat_gap`) collapses two motions onto `cross_sell` for v0.x — see `recommendations list --help` for the mapping.",
    seeAlso: ["cross-sell", "upsell", "add-on", "seat-gap"],
    reference: "pax8 recommendations list --help",
  },
  {
    term: "mrr-uplift",
    aliases: ["mrr", "estimated-mrr-uplift", "estimatedmrruplift", "pax8-cost-plus", "pax8 cost+"],
    category: "recommendation",
    short:
      "Estimated monthly Pax8-cost increase if a recommendation is executed.",
    detail:
      "Shown as the `Pax8 Cost+` column in `recommendations list` and as `estimatedMrrUplift` in JSON. It's the sort key — recommendations are ranked by uplift descending, with priority breaking ties. Note this is added Pax8 cost (what the partner pays Pax8), not partner-side resale revenue.",
    seeAlso: ["pax8-cost", "priority", "recommendation"],
    reference: "pax8 recommendations list",
  },
  {
    term: "pax8-cost",
    aliases: ["pax8 cost", "partner-cost", "partner cost", "partner-buy-rate"],
    category: "billing",
    short:
      "The partner's cost paid to Pax8 for a subscription — not partner-side resale revenue.",
    detail:
      "Aggregated in `dashboard`, `report subscriptions`, and per-customer via `clients more`. The dashboard's `monthlyCost.amount` / `annualCost.amount` are portfolio-wide sums of this value.",
    seeAlso: ["mrr-uplift", "billing-term"],
    reference: "pax8 dashboard",
  },
  {
    term: "orderable",
    category: "recommendation",
    short:
      "A recommendation is orderable when the recommended product is in the partner's catalog and can be added via `orders create`.",
    detail:
      "Recommendations flagged as not orderable are hidden from the table by default. Use `--include-all` to see them — the underlying gap is real, but the fulfillment path isn't.",
    seeAlso: ["catalog", "recommendation"],
    reference: "pax8 recommendations list --include-all",
  },
  {
    term: "commitment-term",
    aliases: ["commitment", "commitmentterm"],
    category: "subscription",
    short:
      "How long the customer is contractually locked into a subscription — Monthly, Annual, 2-Year, or 3-Year.",
    detail:
      "Distinct from billing term. A subscription can commit for a year but bill monthly. The commitment governs early-cancellation policy.",
    seeAlso: ["billing-term"],
    reference: "pax8 subscriptions cancel / update",
  },
  {
    term: "billing-term",
    aliases: ["billingterm"],
    category: "subscription",
    short:
      "How often the customer is invoiced — typically Monthly or Annual.",
    detail:
      "Frequently confused with commitment term. Billing term is invoice cadence; commitment term is contractual lock-in.",
    seeAlso: ["commitment-term"],
    reference: "pax8 subscriptions list --json",
  },
  {
    term: "priority",
    category: "recommendation",
    short:
      "Heuristic ranking on recommendations: high, medium, or low.",
    detail:
      "Rendered as `HIGH`, `MED`, `LOW` in the recommendations table. Used as a tiebreaker when two recommendations have identical `estimatedMrrUplift` — a $5k/mo medium still outranks a $500/mo high on the primary sort.",
    seeAlso: ["mrr-uplift", "recommendation"],
    reference: "pax8 recommendations list",
  },
  {
    term: "catalog",
    category: "product",
    short:
      "The set of products the partner is authorized to sell via Pax8.",
    detail:
      "A recommendation may target a product outside the partner's catalog — those show as `hidden` in `recommendations list` unless `--include-all` is passed. Ask your Pax8 rep to enable a category to unblock those recs.",
    seeAlso: ["orderable"],
    reference: "pax8 products list",
  },
  {
    term: "demo-mode",
    aliases: ["demo", "pax8-demo", "pax8_demo"],
    category: "operational",
    short:
      "Set `PAX8_DEMO=1` to run every command against a synthetic fixture instead of the real API.",
    detail:
      "Two scales: the default (~12 companies, dozens of subscriptions) suits screenshots and golden-path checks; `PAX8_DEMO_SCALE=large` swaps in a 1,000-company / 5,000-subscription fixture for scale testing.",
    seeAlso: [],
    reference: "PAX8_DEMO=1 pax8 <any-command>",
  },
  {
    term: "idempotency-key",
    aliases: ["idempotencykey", "idempotency"],
    category: "operational",
    short:
      "A UUID passed to every write command so a retry can't duplicate the write.",
    detail:
      "The CLI auto-generates one if `--idempotency-key <uuid>` is omitted. On SIGINT during an in-flight write, the key is logged with `(cancelled)` so you can safely retry with the same key.",
    seeAlso: [],
    reference: "pax8 orders create --idempotency-key <uuid>",
  },
  {
    term: "recommendation",
    aliases: ["rec", "recs"],
    category: "recommendation",
    short:
      "A computed suggestion to add or expand a subscription, produced by `pax8 recommendations list`.",
    detail:
      "Every recommendation carries a type (`seat_gap` or `cross_sell`), an opportunity type (Upsell / Cross-sell / Add-on / Upgrade / Net-new), a priority (high/medium/low), and an estimated MRR uplift used as the primary sort key.",
    seeAlso: ["seat-gap", "cross-sell", "opportunity-type", "mrr-uplift", "priority", "orderable"],
    reference: "pax8 recommendations list",
  },
] as const;

// ─── Lookup index ───────────────────────────────────────────────────────────

const NORMALIZE_RE = /[\s_]+/g;

/**
 * Normalize user input to the canonical kebab-case form we index by.
 * Lowercases, collapses whitespace and underscores to a single `-`,
 * and trims edge hyphens. Idempotent.
 */
export function normalizeTerm(input: string): string {
  return input
    .toLowerCase()
    .replace(NORMALIZE_RE, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const INDEX = ((): Map<string, GlossaryEntry> => {
  const m = new Map<string, GlossaryEntry>();
  for (const entry of GLOSSARY) {
    m.set(entry.term, entry);
    for (const alias of entry.aliases ?? []) {
      const key = normalizeTerm(alias);
      // A collision here means two glossary entries claim the same
      // alias — deterministic authoring bug, worth failing loud so
      // the startup contract test catches it.
      if (m.has(key) && m.get(key) !== entry) {
        throw new Error(
          `explain-glossary: alias "${alias}" (normalized "${key}") collides across "${
            m.get(key)!.term
          }" and "${entry.term}"`,
        );
      }
      m.set(key, entry);
    }
  }
  return m;
})();

/** Look up a term (canonical slug or any alias). Returns `undefined` on miss. */
export function lookupTerm(input: string): GlossaryEntry | undefined {
  return INDEX.get(normalizeTerm(input));
}

/** All canonical slugs, alphabetized. Used by `--list` and by suggest(). */
export function allCanonicalTerms(): string[] {
  return GLOSSARY.map((e) => e.term).sort();
}
