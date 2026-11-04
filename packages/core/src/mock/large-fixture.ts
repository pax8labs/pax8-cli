// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// Large-portfolio fixture for scale testing (#484).
//
// Generates ~1000 companies, ~100 products, ~5000 subscriptions, ~45000
// orders from a deterministic seed, plus the matching contact / pricing
// rows. The hand-curated fixture in `./demo-data.ts` stays the default
// for onboarding screenshots and golden-path tests — this one is opt-in
// via `PAX8_DEMO_SCALE=large` and exists to surface bugs that only
// manifest at portfolio scale (pagination invisibility, 200-cap name
// enrichment, currency rendering, BillingTerm normalization, hostile
// company names that break `orderCommand` interpolation, etc.).
//
// Everything is generated from a single seed (`SEED`) using a fast,
// dependency-free PRNG (mulberry32), so two runs with the same env
// produce identical fixtures and CI assertions are stable across
// machines and minor library updates.

import {
  webhookTopicDefinitions,
  type Company,
  type Subscription,
  type Product,
  type ProductPricing,
  type Invoice,
  type InvoiceItem,
  type Order,
  type OrderLineItem,
  type Contact,
  type UsageSummary,
  type UsageLine,
  type Quote,
  type Webhook,
  type WebhookLog,
  type WebhookTopicDefinition,
} from "./demo-data.js";

// ─── PRNG ────────────────────────────────────────────────────────────────────
// Mulberry32: a fast, deterministic 32-bit PRNG. Same seed → same sequence,
// across Node versions and CPU architectures. Don't replace with `Math.random`
// or the fixture stops being reproducible.

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x504158_38; // "PAX8" as hex — easy to spot if it ever leaks into logs

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRng(): {
  next: () => number;
  pick: <T>(arr: readonly T[]) => T;
  pickWeighted: <T>(arr: readonly (readonly [T, number])[]) => T;
  intBetween: (lo: number, hi: number) => number;
  uuid: (prefix: string, index: number) => string;
  dateBetween: (startMs: number, endMs: number) => string;
} {
  const rng = mulberry32(SEED);
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rng() * arr.length)];
  const pickWeighted = <T,>(arr: readonly (readonly [T, number])[]) => {
    const total = arr.reduce((s, [, w]) => s + w, 0);
    let r = rng() * total;
    for (const [v, w] of arr) {
      r -= w;
      if (r <= 0) return v;
    }
    return arr[arr.length - 1][0];
  };
  const intBetween = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  // Deterministic UUID-shaped IDs. Not real UUIDs, but pass the redactor and
  // the various 8-character substring checks (`.slice(0, 8)`) the CLI does.
  const uuid = (prefix: string, index: number) => {
    const h = (index * 0x9e3779b1) >>> 0;
    const hex = h.toString(16).padStart(8, "0");
    return `${prefix}-${hex}-${hex.slice(0, 4)}-${hex.slice(4, 8)}-0000${hex}0000`;
  };
  const dateBetween = (startMs: number, endMs: number) => {
    const t = startMs + Math.floor(rng() * (endMs - startMs));
    return new Date(t).toISOString().split("T")[0];
  };
  return { next: rng, pick, pickWeighted, intBetween, uuid, dateBetween };
}

// ─── Company-name corpus ─────────────────────────────────────────────────────
// Mix of plausible MSP / SMB customer names plus a deliberately-hostile tail
// so the fixture exercises shell-quoting bugs (#462), Unicode rendering, and
// long-name truncation.

const COMPANY_PREFIXES = [
  "Summit", "Coastline", "Redwood", "Bright", "Pinnacle", "Acme", "Anvil",
  "Beacon", "Cedar", "Clarity", "Compass", "Cornerstone", "Crestview",
  "Crown", "Delta", "Eastwood", "Echo", "Elm", "Evergreen", "Foundry",
  "Gateway", "Granite", "Greenleaf", "Harbor", "Heritage", "Highland",
  "Horizon", "Ironside", "Keystone", "Lakeview", "Lighthouse", "Maple",
  "Meridian", "Midwest", "Mountainview", "North Star", "Oakwood", "Pacific",
  "Pioneer", "Prairie", "Prospect", "Ridge", "Riverbend", "Sapphire",
  "Sierra", "Silverstone", "Skyline", "Solstice", "Sterling", "Stonebridge",
  "Sunrise", "Tide", "Timberline", "Tower", "Trailhead", "Trident",
  "Vanguard", "Vertex", "Vista", "Westwind", "Whitestone", "Willow",
];

const COMPANY_SUFFIXES = [
  "Healthcare Partners", "Legal Group", "Manufacturing", "Academy",
  "Financial Advisors", "Logistics", "Construction", "Engineering",
  "Consulting", "Technologies", "Solutions", "Systems", "Services",
  "Holdings", "Industries", "Capital", "Realty", "Insurance",
  "Properties", "Ventures", "Labs", "Group", "Associates", "Partners",
  "& Co", "LLC", "Inc.", "Corp.", "Limited",
];

// Deliberately-hostile names. These exist to surface bugs that demo data
// hides — they should round-trip through the CLI without breaking shell
// interpolation, JSON serialization, or terminal rendering.
const HOSTILE_NAMES = [
  `Acme " Quoted " Inc.`,
  `O'Brien & Associates`,
  `Smith \\ Sons LLC`,
  `Café del Mar SARL`,
  `北京科技 Tech Co`,
  `<script>alert(1)</script> Holdings`,
  `$ENV_VAR Industries`,
  `\`backtick\` Capital`,
  `Tab\there\tCorp`,
  `Newline\nCo`,
  `Drop;Table--Inc`,
  `Müller & Söhne GmbH`,
];

// ─── Product corpus ──────────────────────────────────────────────────────────

const VENDORS = [
  "Microsoft", "Google", "Acronis", "Dropsuite", "Bitdefender", "Webroot",
  "ESET", "Datto", "ConnectWise", "Kaseya", "N-able", "Veeam",
  "SentinelOne", "Sophos", "Proofpoint", "Mimecast", "KnowBe4", "Cisco",
  "Trend Micro", "AvePoint", "Carbonite", "MSP360",
];

const PRODUCT_KINDS = [
  ["Productivity Suite", "Email", "Office Apps", "Teams"],
  ["Endpoint Detection", "Antivirus", "EDR", "XDR"],
  ["Backup & Recovery", "Cloud Backup", "DR Suite"],
  ["Email Security", "Phishing Protection", "Encryption"],
  ["Security Awareness", "Phishing Simulation", "Training"],
  ["RMM", "PSA Integration", "Monitoring"],
  ["Identity", "MFA", "SSO", "Conditional Access"],
];

// ─── Currency corpus ─────────────────────────────────────────────────────────
// Weighted toward USD (real partner distribution) but with enough non-USD
// volume to surface the `formatCurrency` always-$ bug (#472).

const CURRENCY_WEIGHTS = [
  ["USD", 70],
  ["EUR", 12],
  ["GBP", 10],
  ["CAD", 8],
] as const;

// ─── Billing-term corpus ─────────────────────────────────────────────────────
// Every value from BillingTermSchema. `One-Time` / `Trial` / `Activation`
// are deliberately seeded so the `subscriptionMrr` regression for those
// terms (#465) can be asserted under scale.

const BILLING_TERMS = [
  ["Monthly", 50],
  ["Annual", 25],
  ["2-Year", 8],
  ["3-Year", 5],
  ["One-Time", 5],
  ["Trial", 4],
  ["Activation", 3],
] as const;

const SUB_STATUS = [
  ["Active", 75],
  ["Trial", 5],
  ["PendingManual", 3],
  ["PendingCancel", 2],
  ["Cancelled", 15],
] as const;

const ORDER_STATUS = [
  ["Completed", 85],
  ["Processing", 8],
  ["Failed", 4],
  ["PendingManual", 3],
] as const;

// ─── Generators ──────────────────────────────────────────────────────────────

interface FixtureCounts {
  companies: number;
  products: number;
  subscriptions: number;
  orders: number;
}

const DEFAULT_COUNTS: FixtureCounts = {
  companies: 1000,
  products: 100,
  subscriptions: 5000,
  orders: 45000,
};

function generateCompanies(count: number, rng: ReturnType<typeof makeRng>): Company[] {
  const result: Company[] = [];
  // Reserve the last N slots for the hostile names so they always exist
  // regardless of count.
  const hostileSlots = Math.min(HOSTILE_NAMES.length, count);
  const normalCount = count - hostileSlots;
  for (let i = 0; i < normalCount; i++) {
    const name = `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_SUFFIXES)}`;
    const createdMs = Date.UTC(2013, 0, 1) + Math.floor(rng.next() * (Date.now() - Date.UTC(2013, 0, 1)));
    const createdAt = new Date(createdMs).toISOString().split("T")[0];
    result.push(buildCompany(i, name, createdAt, rng));
  }
  for (let h = 0; h < hostileSlots; h++) {
    const index = normalCount + h;
    const createdMs = Date.UTC(2018, 0, 1) + Math.floor(rng.next() * (Date.now() - Date.UTC(2018, 0, 1)));
    const createdAt = new Date(createdMs).toISOString().split("T")[0];
    result.push(buildCompany(index, HOSTILE_NAMES[h], createdAt, rng));
  }
  return result;
}

function buildCompany(index: number, name: string, createdAt: string, rng: ReturnType<typeof makeRng>): Company {
  const id = rng.uuid("co", index);
  const status = rng.pickWeighted([["Active", 92], ["Inactive", 7], ["Deleted", 1]] as const);
  return {
    id,
    name,
    address: {
      street: `${rng.intBetween(100, 9999)} Main St`,
      city: rng.pick(["Denver", "Miami", "Chicago", "Seattle", "Austin", "Boston", "Atlanta", "Portland", "London", "Berlin", "Toronto", "Dublin"]),
      stateOrProvince: rng.pick(["CO", "FL", "IL", "WA", "TX", "MA", "GA", "OR", "ON", "BC"]),
      postalCode: String(rng.intBetween(10000, 99999)),
      country: rng.pickWeighted([["US", 80], ["CA", 8], ["GB", 7], ["DE", 3], ["FR", 2]] as const),
    },
    phone: `+1-${rng.intBetween(200, 999)}-${rng.intBetween(100, 999)}-${String(rng.intBetween(0, 9999)).padStart(4, "0")}`,
    website: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, "")}.example.com`.slice(0, 80),
    status,
    billOnBehalfOfEnabled: rng.next() > 0.2,
    selfServiceAllowed: rng.next() > 0.5,
    orderApprovalRequired: rng.next() > 0.7,
    externalId: rng.next() > 0.4 ? `PSA-${String(index).padStart(6, "0")}` : undefined,
    createdAt,
  };
}

function generateProducts(count: number, rng: ReturnType<typeof makeRng>): Product[] {
  const result: Product[] = [];
  for (let i = 0; i < count; i++) {
    const vendor = rng.pick(VENDORS);
    const kindGroup = rng.pick(PRODUCT_KINDS);
    const kind = rng.pick(kindGroup);
    const tier = rng.pick(["Basic", "Standard", "Premium", "Business", "Enterprise"]);
    const name = `${vendor} ${kind} ${tier}`;
    const id = rng.uuid("prod", i);
    const sku = `${vendor.toLowerCase().slice(0, 3)}-${kind.toLowerCase().replace(/\s+/g, "")}-${tier.toLowerCase().slice(0, 3)}-${String(i).padStart(4, "0")}`;
    const partnerBuyRate = Number((5 + rng.next() * 195).toFixed(2));
    const suggestedRetailPrice = Number((partnerBuyRate * (1.15 + rng.next() * 0.6)).toFixed(2));
    const pricing: ProductPricing[] = [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyRate,
        suggestedRetailPrice,
        flatPrice: partnerBuyRate,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyRate: Number((partnerBuyRate * 0.9).toFixed(2)),
        suggestedRetailPrice: Number((suggestedRetailPrice * 0.9).toFixed(2)),
        flatPrice: Number((partnerBuyRate * 0.9).toFixed(2)),
      },
    ];
    result.push({
      id,
      name,
      vendorName: vendor,
      sku,
      shortDescription: `${kind} from ${vendor}, ${tier} tier.`,
      unitOfMeasurement: rng.pickWeighted([["seat", 70], ["license", 20], ["GB", 7], ["mailbox", 3]] as const),
      pricing,
    });
  }
  return result;
}

function generateSubscriptions(
  companies: Company[],
  products: Product[],
  count: number,
  rng: ReturnType<typeof makeRng>,
): Subscription[] {
  const result: Subscription[] = [];
  for (let i = 0; i < count; i++) {
    const company = rng.pick(companies);
    const product = rng.pick(products);
    const billingTerm = rng.pickWeighted(BILLING_TERMS);
    const status = rng.pickWeighted(SUB_STATUS);
    const quantity = rng.intBetween(1, 250);
    const startMs = Date.UTC(2015, 0, 1) + Math.floor(rng.next() * (Date.now() - Date.UTC(2015, 0, 1)));
    const startDate = new Date(startMs).toISOString().split("T")[0];
    const pricing = product.pricing[0];
    const price = pricing.flatPrice ?? pricing.partnerBuyRate;
    const currencyCode = rng.pickWeighted(CURRENCY_WEIGHTS);
    // Commitment-term end date: ~1 year out for committed terms, null for monthly/one-time.
    const hasCommitment = billingTerm === "Annual" || billingTerm === "2-Year" || billingTerm === "3-Year";
    const commitmentMonths = billingTerm === "2-Year" ? 24 : billingTerm === "3-Year" ? 36 : 12;
    const commitmentEnd = hasCommitment
      ? new Date(startMs + commitmentMonths * 30 * 86_400_000).toISOString().split("T")[0]
      : null;
    result.push({
      id: rng.uuid("sub", i),
      companyId: company.id,
      productId: product.id,
      productName: product.name,
      quantity,
      startDate,
      createdAt: startDate,
      billingStart: startDate,
      status,
      price,
      currencyCode,
      billingTerm,
      commitment: hasCommitment
        ? { id: rng.uuid("cmt", i), term: billingTerm.replace("-Year", "Y"), endDate: commitmentEnd! }
        : undefined,
      commitmentTermEndDate: commitmentEnd,
      provisioningStatus: rng.pickWeighted([["Provisioned", 88], ["Pending", 8], ["Error", 4]] as const),
      companyName: company.name,
    });
  }
  return result;
}

function generateOrders(
  companies: Company[],
  products: Product[],
  count: number,
  rng: ReturnType<typeof makeRng>,
): Order[] {
  const result: Order[] = [];
  const startMs = Date.UTC(2013, 0, 1);
  const endMs = Date.now();
  for (let i = 0; i < count; i++) {
    const company = rng.pick(companies);
    const createdAt = rng.dateBetween(startMs, endMs);
    const lineItemCount = rng.pickWeighted([[1, 70], [2, 20], [3, 7], [4, 2], [5, 1]] as const);
    const lineItems: OrderLineItem[] = [];
    for (let li = 0; li < lineItemCount; li++) {
      const product = rng.pick(products);
      lineItems.push({
        id: rng.uuid("oli", i * 10 + li),
        productId: product.id,
        productName: product.name,
        lineItemNumber: li + 1,
        quantity: rng.intBetween(1, 100),
        billingTerm: rng.pickWeighted([
          ["Monthly", 50], ["Annual", 30], ["2-Year", 6], ["3-Year", 4],
          ["One-Time", 5], ["Trial", 3], ["Activation", 2],
        ] as const),
      });
    }
    result.push({
      id: rng.uuid("ord", i),
      companyId: company.id,
      companyName: company.name,
      orderedBy: "Pax8 Partner",
      orderedByEmail: "partner@example.com",
      createdAt,
      lineItems,
      status: rng.pickWeighted(ORDER_STATUS),
    });
  }
  return result;
}

function generateContacts(companies: Company[], rng: ReturnType<typeof makeRng>): Contact[] {
  const result: Contact[] = [];
  let contactIndex = 0;
  for (const company of companies) {
    const contactCount = rng.intBetween(1, 3);
    for (let c = 0; c < contactCount; c++) {
      const firstName = rng.pick(["Alex", "Jordan", "Casey", "Morgan", "Riley", "Taylor", "Avery", "Quinn", "Reese", "Skyler", "Cameron", "Drew", "Hayden", "Parker", "Sage"]);
      const lastName = rng.pick(["Smith", "Johnson", "Lee", "Patel", "Garcia", "Brown", "Davis", "Wilson", "Martinez", "Anderson", "Thomas", "Jackson"]);
      const types: Contact["types"] = [];
      if (c === 0) {
        // Primary contact carries all three types
        types.push({ type: "Admin", primary: true });
        types.push({ type: "Billing", primary: true });
        types.push({ type: "Technical", primary: true });
      } else {
        types.push({ type: rng.pick(["Admin", "Billing", "Technical"] as const), primary: false });
      }
      result.push({
        id: rng.uuid("contact", contactIndex++),
        companyId: company.id,
        firstName,
        lastName,
        email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com`,
        types,
      });
    }
  }
  return result;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export interface LargeFixture {
  companies: Company[];
  products: Product[];
  subscriptions: Subscription[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  orders: Order[];
  contacts: Contact[];
  usageSummaries: UsageSummary[];
  usageLines: UsageLine[];
  quotes: Quote[];
  webhooks: Webhook[];
  webhookLogs: WebhookLog[];
  webhookTopicDefinitions: WebhookTopicDefinition[];
}

/**
 * Build a deterministic large-scale fixture. The same SEED produces the
 * same data across runs and machines. Counts can be overridden for tests
 * that want a smaller-but-still-realistic shape.
 *
 * Cost: ~1–2 seconds for default counts (45k orders is the bulk of the work).
 * Memory: ~30–50 MB resident. The fixture is intended to load once per
 * process; `fixture.ts` caches the result.
 *
 * Currently populated: companies, products, subscriptions, orders, contacts.
 * Empty arrays for the remaining entity types — those will be filled in as
 * specific scale-matrix assertions need them. `webhookTopicDefinitions` is
 * reused from the small fixture because it's a global Pax8 catalog, not
 * per-tenant.
 */
export function buildLargeFixture(overrides?: Partial<FixtureCounts>): LargeFixture {
  const counts = { ...DEFAULT_COUNTS, ...overrides };
  const rng = makeRng();
  const companies = generateCompanies(counts.companies, rng);
  const products = generateProducts(counts.products, rng);
  const subscriptions = generateSubscriptions(companies, products, counts.subscriptions, rng);
  const orders = generateOrders(companies, products, counts.orders, rng);
  const contacts = generateContacts(companies, rng);
  return {
    companies,
    products,
    subscriptions,
    invoices: [],
    invoiceItems: [],
    orders,
    contacts,
    usageSummaries: [],
    usageLines: [],
    quotes: [],
    webhooks: [],
    webhookLogs: [],
    webhookTopicDefinitions, // reuse: this is a Pax8 global catalog, not tenant data
  };
}
