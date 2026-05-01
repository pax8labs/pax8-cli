// Demo data for PAX8_DEMO=1 mode
// All data is realistic but fictional. UUIDs are deterministic for testing.

// ─── Helper: relative dates from "now" ───────────────────────────────────────

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().split("T")[0];
}

function monthsAgo(months: number): string {
  // Use UTC and the 1st of the month to avoid end-of-month rollover bugs
  // (e.g. on April 30, naive `setMonth(month - 2)` would land on March 2, not February).
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - months, 1));
  return d.toISOString().split("T")[0];
}

// ─── Interfaces ──────────────────────────────────────────────────────────────

export interface Company {
  id: string;
  name: string;
  address: {
    street: string;
    city: string;
    stateOrProvince: string;
    postalCode: string;
    country: string;
  };
  phone: string;
  website: string;
  status: "Active" | "Inactive" | "Deleted";
  billOnBehalfOfEnabled: boolean;
  selfServiceAllowed: boolean;
  orderApprovalRequired: boolean;
  createdDate: string;
  billingContact?: { firstName: string; lastName: string; email: string };
}

export interface Subscription {
  id: string;
  companyId: string;
  productId: string;
  productName: string;
  quantity: number;
  startDate: string;
  createdDate: string;
  billingStart: string;
  status: "Active" | "Trial" | "PendingManual" | "Cancelled" | "PendingCancel";
  price: number;
  billingTerm: "Monthly" | "Annual";
  commitment?: { id: string; term: string; endDate: string };
  commitmentTermEndDate: string | null;
  provisioningStatus: "Provisioned" | "Pending" | "Error";
  companyName?: string; // denormalized for convenience
}

export interface Product {
  id: string;
  name: string;
  vendorName: string;
  sku: string;
  shortDescription: string;
  unitOfMeasure: string;
  pricing: ProductPricing[];
}

export interface ProductPricing {
  billingTerm: "Monthly" | "Annual";
  commitmentTerm: "Monthly" | "1-Year" | "3-Year";
  partnerBuyPrice: number;
  suggestedRetailPrice: number;
  flatPrice?: number;
  ranges?: { minQuantity: number; maxQuantity: number; unitPrice: number }[];
}

export interface Invoice {
  id: string;
  companyId: string;
  companyName: string;
  invoiceDate: string;
  dueDate: string;
  status: "Unpaid" | "Paid" | "Void" | "Overdue";
  total: number;
  balance: number;
  currency: string;
}

export interface InvoiceItem {
  id: string;
  invoiceId: string;
  companyId: string;
  companyName: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  total: number;
  billingPeriodStart: string;
  billingPeriodEnd: string;
}

export interface Order {
  id: string;
  companyId: string;
  companyName: string;
  orderedBy: string;
  orderedByEmail: string;
  createdDate: string;
  lineItems: OrderLineItem[];
  status: "Completed" | "Processing" | "Failed" | "PendingManual";
}

export interface OrderLineItem {
  productId: string;
  productName: string;
  quantity: number;
  billingTerm: "Monthly" | "Annual";
  provisioningDetails?: Record<string, string>;
}

export interface Contact {
  id: string;
  companyId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  type: "Admin" | "Billing" | "Technical";
  isPrimary: boolean;
  createdDate: string;
}

export interface UsageSummary {
  id: string;
  companyId: string;
  companyName: string;
  productId: string;
  productName: string;
  date: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  resourceGroup?: string;
}

export interface UsageLine {
  id: string;
  usageSummaryId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  date: string;
}

export interface Quote {
  id: string;
  companyId: string;
  companyName: string;
  createdDate: string;
  expirationDate: string;
  status: "Draft" | "Sent" | "Accepted" | "Expired" | "Rejected";
  total: number;
  lineItems: QuoteLineItem[];
}

export interface QuoteLineItem {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  billingTerm: "Monthly" | "Annual";
}

export interface Webhook {
  id: string;
  url: string;
  status: "Active" | "Inactive" | "Failed";
  topics: string[];
  createdDate: string;
  lastTriggeredDate: string | null;
  secret: string;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  topic: string;
  status: "Success" | "Failed";
  statusCode: number;
  triggeredDate: string;
  responseTime: number;
}

// ─── Company IDs ─────────────────────────────────────────────────────────────

const SUMMIT_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
const COASTLINE_ID = "b2c3d4e5-f6a7-8901-bcde-f12345678901";
const REDWOOD_ID = "c3d4e5f6-a7b8-9012-cdef-123456789012";
const BRIGHT_ID = "d4e5f6a7-b8c9-0123-defa-234567890123";
const PINNACLE_ID = "e5f6a7b8-c9d0-1234-efab-345678901234";

// ─── Companies ───────────────────────────────────────────────────────────────

export const companies: Company[] = [
  {
    id: SUMMIT_ID,
    name: "Summit Healthcare Partners",
    address: {
      street: "4500 Cherry Creek Dr S",
      city: "Denver",
      stateOrProvince: "CO",
      postalCode: "80246",
      country: "US",
    },
    phone: "+1-303-555-0101",
    website: "https://summithealthcare.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
    createdDate: "2023-06-15",
    billingContact: {
      firstName: "Rachel",
      lastName: "Thornton",
      email: "rachel.thornton@summithealthcare.example.com",
    },
  },
  {
    id: COASTLINE_ID,
    name: "Coastline Legal Group",
    address: {
      street: "1200 Brickell Ave, Suite 1800",
      city: "Miami",
      stateOrProvince: "FL",
      postalCode: "33131",
      country: "US",
    },
    phone: "+1-305-555-0202",
    website: "https://coastlinelegal.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: true,
    orderApprovalRequired: true,
    createdDate: "2024-01-10",
    billingContact: {
      firstName: "Marco",
      lastName: "Reyes",
      email: "marco.reyes@coastlinelegal.example.com",
    },
  },
  {
    id: REDWOOD_ID,
    name: "Redwood Manufacturing",
    address: {
      street: "8900 NW Industrial Way",
      city: "Portland",
      stateOrProvince: "OR",
      postalCode: "97210",
      country: "US",
    },
    phone: "+1-503-555-0303",
    website: "https://redwoodmfg.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: true,
    createdDate: "2022-09-01",
    billingContact: {
      firstName: "Karen",
      lastName: "Olsen",
      email: "karen.olsen@redwoodmfg.example.com",
    },
  },
  {
    id: BRIGHT_ID,
    name: "Bright Minds Academy",
    address: {
      street: "2100 S Lamar Blvd",
      city: "Austin",
      stateOrProvince: "TX",
      postalCode: "78704",
      country: "US",
    },
    phone: "+1-512-555-0404",
    website: "https://brightmindsacademy.example.com",
    status: "Active",
    billOnBehalfOfEnabled: false,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
    createdDate: "2025-03-20",
    billingContact: {
      firstName: "Lisa",
      lastName: "Cheng",
      email: "lisa.cheng@brightminds.example.com",
    },
  },
  {
    id: PINNACLE_ID,
    name: "Pinnacle Financial Advisors",
    address: {
      street: "233 S Wacker Dr, Suite 4200",
      city: "Chicago",
      stateOrProvince: "IL",
      postalCode: "60606",
      country: "US",
    },
    phone: "+1-312-555-0505",
    website: "https://pinnaclefa.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: true,
    orderApprovalRequired: false,
    createdDate: "2024-08-05",
    billingContact: {
      firstName: "David",
      lastName: "Nakamura",
      email: "david.nakamura@pinnaclefa.example.com",
    },
  },
];

// ─── Products ────────────────────────────────────────────────────────────────

export const products: Product[] = [
  {
    id: "prod-m365-biz-prem-0001",
    name: "Microsoft 365 Business Premium [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "SPB",
    shortDescription:
      "Best-in-class Office apps, cloud services, and security for small to medium businesses.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 18.0,
        suggestedRetailPrice: 22.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 16.5,
        suggestedRetailPrice: 22.0,
      },
    ],
  },
  {
    id: "prod-m365-biz-basic-0002",
    name: "Microsoft 365 Business Basic [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "O365_BUSINESS_ESSENTIALS",
    shortDescription:
      "Web and mobile versions of Office apps plus cloud services.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 5.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 4.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
  {
    id: "prod-m365-e3-0003",
    name: "Microsoft 365 E3 [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "SPE_E3",
    shortDescription:
      "Enterprise productivity suite with advanced compliance and security.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 32.0,
        suggestedRetailPrice: 36.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 29.0,
        suggestedRetailPrice: 36.0,
      },
    ],
  },
  {
    id: "prod-m365-e5-0004",
    name: "Microsoft 365 E5 [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "SPE_E5",
    shortDescription:
      "Full Microsoft 365 suite with advanced analytics, voice, and security.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 52.0,
        suggestedRetailPrice: 57.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 48.0,
        suggestedRetailPrice: 57.0,
      },
    ],
  },
  {
    id: "prod-exo-plan1-0005",
    name: "Exchange Online (Plan 1) [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "EXCHANGESTANDARD",
    shortDescription:
      "Business-class email with 50 GB mailbox and custom email domain.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 3.5,
        suggestedRetailPrice: 4.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 3.0,
        suggestedRetailPrice: 4.0,
      },
    ],
  },
  {
    id: "prod-exo-plan2-0006",
    name: "Exchange Online (Plan 2) [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "EXCHANGEENTERPRISE",
    shortDescription:
      "Advanced email with unlimited mailbox storage, DLP, and archiving.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 7.0,
        suggestedRetailPrice: 8.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 6.5,
        suggestedRetailPrice: 8.0,
      },
    ],
  },
  {
    id: "prod-defender-biz-0007",
    name: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "ATP_P1",
    shortDescription:
      "Safe Attachments, Safe Links, and real-time detections for Office 365.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 2.5,
        suggestedRetailPrice: 3.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 2.0,
        suggestedRetailPrice: 3.0,
      },
    ],
  },
  {
    id: "prod-aad-p1-0008",
    name: "Microsoft Entra ID P1 [New Commerce Experience]",
    vendorName: "Microsoft",
    sku: "AAD_PREMIUM",
    shortDescription:
      "Cloud identity and access management with conditional access, MFA, and SSO.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 5.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 4.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
  {
    id: "prod-acronis-backup-0009",
    name: "AvePoint Cloud Backup for Microsoft 365",
    vendorName: "AvePoint",
    sku: "AVEPOINT_CLOUD_BACKUP_M365",
    shortDescription:
      "Comprehensive SaaS backup for Microsoft 365 including Exchange, SharePoint, OneDrive, and Teams.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 6.0,
        suggestedRetailPrice: 8.5,
      },
    ],
  },
  {
    id: "prod-s1-singularity-0010",
    name: "CrowdStrike MSSP Complete Defend",
    vendorName: "CrowdStrike",
    sku: "CS_MSSP_COMPLETE_DEFEND",
    shortDescription:
      "Complete managed detection and response (MDR) with endpoint, identity, and cloud protection.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        commitmentTerm: "Monthly",
        partnerBuyPrice: 4.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        commitmentTerm: "1-Year",
        partnerBuyPrice: 3.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
];

// ─── Subscriptions ───────────────────────────────────────────────────────────
// Summit Healthcare Partners: 3 subs, ~$2,635 MRR — ALL renewing in 3 days (missing backup + identity)
// Coastline Legal Group: 2 subs, ~$1,760 MRR — renewing in 18 days (missing endpoint + identity + backup)
// Redwood Manufacturing: 7 subs, ~$12,630 MRR — big complex stack, 45+ days out
// Bright Minds Academy: 2 subs, ~$150 MRR — budget-conscious, trial expiring in 5 days
// Pinnacle Financial Advisors: 3 subs, ~$660 MRR — renewing in 10 days

export const subscriptions: Subscription[] = [
  // ── Summit Healthcare Partners (3 subs, ~$2,635 MRR) — ALL renewing in 3 DAYS ──
  {
    id: "sub-summit-m365bp-001",
    companyId: SUMMIT_ID,
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    quantity: 85,
    startDate: "2025-03-26",
    createdDate: "2025-03-20",
    billingStart: "2025-03-26",
    status: "Active",
    price: 22.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0001-0001-0001-000000000001", term: "1-Year", endDate: daysFromNow(3) },
    commitmentTermEndDate: daysFromNow(3), // renews in 3 days!
    provisioningStatus: "Provisioned",
    companyName: "Summit Healthcare Partners",
  },
  {
    id: "sub-summit-defender-002",
    companyId: SUMMIT_ID,
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 85,
    startDate: "2025-03-26",
    createdDate: "2025-03-20",
    billingStart: "2025-03-26",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0001-0001-0001-000000000002", term: "1-Year", endDate: daysFromNow(3) },
    commitmentTermEndDate: daysFromNow(3),
    provisioningStatus: "Provisioned",
    companyName: "Summit Healthcare Partners",
  },
  {
    id: "sub-summit-s1-005",
    companyId: SUMMIT_ID,
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 85,
    startDate: "2025-03-26",
    createdDate: "2025-03-20",
    billingStart: "2025-03-26",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0001-0001-0001-000000000003", term: "1-Year", endDate: daysFromNow(3) },
    commitmentTermEndDate: daysFromNow(3),
    provisioningStatus: "Provisioned",
    companyName: "Summit Healthcare Partners",
  },

  // ── Coastline Legal Group (2 subs, ~$1,760 MRR) — renewing in 18 days ──
  {
    id: "sub-coastline-e3-001",
    companyId: COASTLINE_ID,
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3 [New Commerce Experience]",
    quantity: 40,
    startDate: "2025-04-07",
    createdDate: "2025-04-01",
    billingStart: "2025-04-07",
    status: "Active",
    price: 36.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0002-0001-0001-000000000001", term: "1-Year", endDate: daysFromNow(18) },
    commitmentTermEndDate: daysFromNow(18),
    provisioningStatus: "Provisioned",
    companyName: "Coastline Legal Group",
  },
  {
    id: "sub-coastline-exo2-002",
    companyId: COASTLINE_ID,
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online (Plan 2) [New Commerce Experience]",
    quantity: 40,
    startDate: "2025-04-07",
    createdDate: "2025-04-01",
    billingStart: "2025-04-07",
    status: "Active",
    price: 8.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0002-0001-0001-000000000002", term: "1-Year", endDate: daysFromNow(18) },
    commitmentTermEndDate: daysFromNow(18),
    provisioningStatus: "Provisioned",
    companyName: "Coastline Legal Group",
  },

  // ── Redwood Manufacturing (7 subs, ~$12,630 MRR) — big complex stack, 45+ days ──
  {
    id: "sub-redwood-e3-001",
    companyId: REDWOOD_ID,
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3 [New Commerce Experience]",
    quantity: 100,
    startDate: "2024-05-01",
    createdDate: "2024-04-25",
    billingStart: "2024-05-01",
    status: "Active",
    price: 36.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000001", term: "1-Year", endDate: daysFromNow(55) },
    commitmentTermEndDate: daysFromNow(55),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-e5-002",
    companyId: REDWOOD_ID,
    productId: "prod-m365-e5-0004",
    productName: "Microsoft 365 E5 [New Commerce Experience]",
    quantity: 50,
    startDate: "2024-05-01",
    createdDate: "2024-04-25",
    billingStart: "2024-05-01",
    status: "Active",
    price: 57.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000002", term: "1-Year", endDate: daysFromNow(55) },
    commitmentTermEndDate: daysFromNow(55),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-exo1-003",
    companyId: REDWOOD_ID,
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online (Plan 1) [New Commerce Experience]",
    quantity: 150,
    startDate: "2024-05-01",
    createdDate: "2024-04-25",
    billingStart: "2024-05-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000003", term: "1-Year", endDate: daysFromNow(55) },
    commitmentTermEndDate: daysFromNow(55),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-defender-004",
    companyId: REDWOOD_ID,
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 150,
    startDate: "2024-05-01",
    createdDate: "2024-04-25",
    billingStart: "2024-05-01",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000004", term: "1-Year", endDate: daysFromNow(90) },
    commitmentTermEndDate: daysFromNow(90),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-aad-005",
    companyId: REDWOOD_ID,
    productId: "prod-aad-p1-0008",
    productName: "Microsoft Entra ID P1 [New Commerce Experience]",
    quantity: 150,
    startDate: "2024-05-01",
    createdDate: "2024-04-25",
    billingStart: "2024-05-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000005", term: "1-Year", endDate: daysFromNow(90) },
    commitmentTermEndDate: daysFromNow(90),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-s1-006",
    companyId: REDWOOD_ID,
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 150,
    startDate: "2024-08-01",
    createdDate: "2024-07-25",
    billingStart: "2024-08-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0003-0001-0001-000000000006", term: "1-Year", endDate: daysFromNow(140) },
    commitmentTermEndDate: daysFromNow(140),
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },
  {
    id: "sub-redwood-acronis-007",
    companyId: REDWOOD_ID,
    productId: "prod-acronis-backup-0009",
    productName: "AvePoint Cloud Backup for Microsoft 365",
    quantity: 30,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 8.5,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Redwood Manufacturing",
  },

  // ── Bright Minds Academy (2 subs, ~$150 MRR) — budget-conscious, trial expiring ──
  {
    id: "sub-bright-m365bb-001",
    companyId: BRIGHT_ID,
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic [New Commerce Experience]",
    quantity: 25,
    startDate: "2025-10-01",
    createdDate: "2025-09-28",
    billingStart: "2025-10-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Bright Minds Academy",
  },
  {
    id: "sub-bright-defender-002",
    companyId: BRIGHT_ID,
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 25,
    startDate: "2026-02-20",
    createdDate: "2026-02-18",
    billingStart: "2026-02-20",
    status: "Trial",
    price: 0.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(5), // trial expires in 5 days!
    provisioningStatus: "Provisioned",
    companyName: "Bright Minds Academy",
  },

  // ── Pinnacle Financial Advisors (3 subs, ~$660 MRR) — renewing in 10 days ──
  {
    id: "sub-pinnacle-m365bp-001",
    companyId: PINNACLE_ID,
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    quantity: 15,
    startDate: "2025-04-01",
    createdDate: "2025-03-28",
    billingStart: "2025-04-01",
    status: "Active",
    price: 22.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0005-0001-0001-000000000001", term: "1-Year", endDate: daysFromNow(10) },
    commitmentTermEndDate: daysFromNow(10),
    provisioningStatus: "Provisioned",
    companyName: "Pinnacle Financial Advisors",
  },
  {
    id: "sub-pinnacle-defender-002",
    companyId: PINNACLE_ID,
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 15,
    startDate: "2025-04-01",
    createdDate: "2025-03-28",
    billingStart: "2025-04-01",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0005-0001-0001-000000000002", term: "1-Year", endDate: daysFromNow(10) },
    commitmentTermEndDate: daysFromNow(10),
    provisioningStatus: "Provisioned",
    companyName: "Pinnacle Financial Advisors",
  },
  {
    id: "sub-pinnacle-s1-003",
    companyId: PINNACLE_ID,
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 15,
    startDate: "2025-04-01",
    createdDate: "2025-03-28",
    billingStart: "2025-04-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitment: { id: "cterm-0005-0001-0001-000000000003", term: "1-Year", endDate: daysFromNow(10) },
    commitmentTermEndDate: daysFromNow(10),
    provisioningStatus: "Provisioned",
    companyName: "Pinnacle Financial Advisors",
  },
];

// ─── Invoices ────────────────────────────────────────────────────────────────
// Last 3 months of invoices with line items.
// Current month discrepancies:
//   - Summit Healthcare: M365 BP invoiced 95 seats, only 85 active ($220 overcharge)
//   - Redwood Manufacturing: E5 line MISSING from invoice ($2,850 undercharge — free E5!)
//   - Coastline Legal: billed correctly (clean — only 2 subs, both match)
//   - Pinnacle: Defender invoiced 20 seats, only 15 active ($15 overcharge)
//   - Bright Minds: Entra ID P1 on invoice (25 seats, $150) but NO subscription (unexpected)
// Total overcharge: ~$235/mo | Total undercharge: ~$2,850/mo | Net: MSP losing $2,615/mo

// `monthsAgo` returns YYYY-MM-DD; slice to YYYY-MM for invoice month grouping.
const currentMonth = monthsAgo(0).slice(0, 7); // e.g. "2026-04"
const lastMonth = monthsAgo(1).slice(0, 7);
const twoMonthsAgo = monthsAgo(2).slice(0, 7);

// Summit current month invoice line item totals:
// M365 BP: 95 * 22 = 2,090 (OVERCHARGE: should be 85 * 22 = 1,870)
// Defender: 85 * 3 = 255
// CrowdStrike: 85 * 6 = 510
// Total: 2,855

// Coastline current month invoice line item totals:
// M365 E3: 40 * 36 = 1,440
// Exchange Online Plan 2: 40 * 8 = 320
// Total: 1,760

// Redwood current month invoice line item totals:
// M365 E3: 100 * 36 = 3,600
// Exchange Online Plan 1: 150 * 4 = 600
// Defender: 150 * 3 = 450
// Entra ID P1: 150 * 6 = 900
// CrowdStrike: 150 * 6 = 900
// AvePoint: 30 * 8.5 = 255
// NOTE: E5 line MISSING (should be 50 * 57 = 2,850)
// Total: 6,705

// Bright Minds current month invoice line item totals:
// M365 Business Basic: 25 * 6 = 150
// Entra ID P1: 25 * 6 = 150 (UNEXPECTED: no subscription exists!)
// Total: 300

// Pinnacle current month invoice line item totals:
// M365 BP: 15 * 22 = 330
// Defender: 20 * 3 = 60 (OVERCHARGE: should be 15 * 3 = 45)
// CrowdStrike: 15 * 6 = 90
// Total: 480

export const invoices: Invoice[] = [
  // Current month
  {
    id: "inv-summit-curr-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 2855.0,
    balance: 2855.0,
    currency: "USD",
  },
  {
    id: "inv-coastline-curr-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 1760.0,
    balance: 1760.0,
    currency: "USD",
  },
  {
    id: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 6705.0,
    balance: 6705.0,
    currency: "USD",
  },
  {
    id: "inv-bright-curr-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 300.0,
    balance: 300.0,
    currency: "USD",
  },
  {
    id: "inv-pinnacle-curr-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 480.0,
    balance: 480.0,
    currency: "USD",
  },

  // Last month — clean invoices (no discrepancies)
  {
    id: "inv-summit-last-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 2380.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-coastline-last-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 1760.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-redwood-last-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 9555.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-bright-last-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 150.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-pinnacle-last-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 465.0,
    balance: 0,
    currency: "USD",
  },

  // Two months ago
  {
    id: "inv-summit-2m-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 2380.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-coastline-2m-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 1760.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-redwood-2m-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 9555.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-pinnacle-2m-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 465.0,
    balance: 0,
    currency: "USD",
  },
];

// ─── Invoice Items ───────────────────────────────────────────────────────────
// Current month items with discrepancies baked in

export const invoiceItems: InvoiceItem[] = [
  // ── Summit Healthcare Partners current month ──
  // DISCREPANCY: M365 BP invoiced 95 seats, only 85 active → $220/mo overcharge
  {
    id: "ii-summit-curr-001",
    invoiceId: "inv-summit-curr-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    quantity: 95, // active is 85 → overcharge of 10 * $22 = $220
    unitPrice: 22.0,
    total: 2090.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-summit-curr-002",
    invoiceId: "inv-summit-curr-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 85,
    unitPrice: 3.0,
    total: 255.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-summit-curr-005",
    invoiceId: "inv-summit-curr-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 85,
    unitPrice: 6.0,
    total: 510.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // ── Coastline Legal Group current month — CLEAN, no discrepancies ──
  {
    id: "ii-coastline-curr-001",
    invoiceId: "inv-coastline-curr-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3 [New Commerce Experience]",
    quantity: 40,
    unitPrice: 36.0,
    total: 1440.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-coastline-curr-002",
    invoiceId: "inv-coastline-curr-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online (Plan 2) [New Commerce Experience]",
    quantity: 40,
    unitPrice: 8.0,
    total: 320.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // ── Redwood Manufacturing current month ──
  // DISCREPANCY: E5 line is COMPLETELY MISSING → $2,850/mo undercharge (free E5!)
  {
    id: "ii-redwood-curr-001",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3 [New Commerce Experience]",
    quantity: 100,
    unitPrice: 36.0,
    total: 3600.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  // NOTE: No E5 line item! 50 seats * $57 = $2,850 not being charged
  {
    id: "ii-redwood-curr-002",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online (Plan 1) [New Commerce Experience]",
    quantity: 150,
    unitPrice: 4.0,
    total: 600.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-redwood-curr-003",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 150,
    unitPrice: 3.0,
    total: 450.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-redwood-curr-004",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-aad-p1-0008",
    productName: "Microsoft Entra ID P1 [New Commerce Experience]",
    quantity: 150,
    unitPrice: 6.0,
    total: 900.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-redwood-curr-005",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 150,
    unitPrice: 6.0,
    total: 900.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-redwood-curr-006",
    invoiceId: "inv-redwood-curr-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-acronis-backup-0009",
    productName: "AvePoint Cloud Backup for Microsoft 365",
    quantity: 30,
    unitPrice: 8.5,
    total: 255.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // ── Bright Minds Academy current month ──
  // DISCREPANCY: Entra ID P1 on invoice but NO active subscription → $150/mo unexpected
  {
    id: "ii-bright-curr-001",
    invoiceId: "inv-bright-curr-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic [New Commerce Experience]",
    quantity: 25,
    unitPrice: 6.0,
    total: 150.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-bright-curr-002",
    invoiceId: "inv-bright-curr-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    productId: "prod-aad-p1-0008",
    productName: "Microsoft Entra ID P1 [New Commerce Experience]",
    quantity: 25, // No active Entra ID P1 subscription → unexpected charge
    unitPrice: 6.0,
    total: 150.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // ── Pinnacle Financial Advisors current month ──
  // DISCREPANCY: Defender invoiced 20 seats, only 15 active → $15/mo overcharge
  {
    id: "ii-pinnacle-curr-001",
    invoiceId: "inv-pinnacle-curr-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium [New Commerce Experience]",
    quantity: 15,
    unitPrice: 22.0,
    total: 330.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-pinnacle-curr-002",
    invoiceId: "inv-pinnacle-curr-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
    quantity: 20, // active is 15 → overcharge of 5 * $3 = $15
    unitPrice: 3.0,
    total: 60.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-pinnacle-curr-003",
    invoiceId: "inv-pinnacle-curr-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    productId: "prod-s1-singularity-0010",
    productName: "CrowdStrike MSSP Complete Defend",
    quantity: 15,
    unitPrice: 6.0,
    total: 90.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
];

// ─── Orders ──────────────────────────────────────────────────────────────────

export const orders: Order[] = [
  {
    id: "ord-summit-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    orderedBy: "Rachel Thornton",
    orderedByEmail: "rachel.thornton@summithealthcare.example.com",
    createdDate: "2026-03-08",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-s1-singularity-0010",
        productName: "CrowdStrike MSSP Complete Defend",
        quantity: 85,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "ord-redwood-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    orderedBy: "Karen Olsen",
    orderedByEmail: "karen.olsen@redwoodmfg.example.com",
    createdDate: "2026-02-15",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-acronis-backup-0009",
        productName: "AvePoint Cloud Backup for Microsoft 365",
        quantity: 30,
        billingTerm: "Monthly",
      },
    ],
  },
  {
    id: "ord-pinnacle-001",
    companyId: PINNACLE_ID,
    companyName: "Pinnacle Financial Advisors",
    orderedBy: "David Nakamura",
    orderedByEmail: "david.nakamura@pinnaclefa.example.com",
    createdDate: "2026-01-28",
    status: "Processing",
    lineItems: [
      {
        productId: "prod-m365-biz-prem-0001",
        productName: "Microsoft 365 Business Premium [New Commerce Experience]",
        quantity: 5,
        billingTerm: "Annual",
      },
      {
        productId: "prod-defender-biz-0007",
        productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
        quantity: 5,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "ord-coastline-001",
    companyId: COASTLINE_ID,
    companyName: "Coastline Legal Group",
    orderedBy: "Marco Reyes",
    orderedByEmail: "marco.reyes@coastlinelegal.example.com",
    createdDate: "2025-04-01",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-m365-e3-0003",
        productName: "Microsoft 365 E3 [New Commerce Experience]",
        quantity: 40,
        billingTerm: "Annual",
      },
      {
        productId: "prod-exo-plan2-0006",
        productName: "Exchange Online (Plan 2) [New Commerce Experience]",
        quantity: 40,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "ord-bright-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    orderedBy: "Lisa Cheng",
    orderedByEmail: "lisa.cheng@brightminds.example.com",
    createdDate: "2025-09-28",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-m365-biz-basic-0002",
        productName: "Microsoft 365 Business Basic [New Commerce Experience]",
        quantity: 25,
        billingTerm: "Monthly",
      },
    ],
  },
];

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contacts: Contact[] = [
  {
    id: "contact-summit-001",
    companyId: SUMMIT_ID,
    firstName: "Rachel",
    lastName: "Thornton",
    email: "rachel.thornton@summithealthcare.example.com",
    phone: "+1-303-555-0111",
    type: "Admin",
    isPrimary: true,
    createdDate: "2023-06-15",
  },
  {
    id: "contact-summit-002",
    companyId: SUMMIT_ID,
    firstName: "Tom",
    lastName: "Bridger",
    email: "tom.bridger@summithealthcare.example.com",
    phone: "+1-303-555-0112",
    type: "Billing",
    isPrimary: false,
    createdDate: "2023-08-20",
  },
  {
    id: "contact-coastline-001",
    companyId: COASTLINE_ID,
    firstName: "Marco",
    lastName: "Reyes",
    email: "marco.reyes@coastlinelegal.example.com",
    phone: "+1-305-555-0211",
    type: "Admin",
    isPrimary: true,
    createdDate: "2024-01-10",
  },
  {
    id: "contact-coastline-002",
    companyId: COASTLINE_ID,
    firstName: "Sarah",
    lastName: "Vasquez",
    email: "sarah.vasquez@coastlinelegal.example.com",
    phone: "+1-305-555-0212",
    type: "Technical",
    isPrimary: false,
    createdDate: "2024-03-15",
  },
  {
    id: "contact-redwood-001",
    companyId: REDWOOD_ID,
    firstName: "Karen",
    lastName: "Olsen",
    email: "karen.olsen@redwoodmfg.example.com",
    phone: "+1-503-555-0311",
    type: "Admin",
    isPrimary: true,
    createdDate: "2022-09-01",
  },
  {
    id: "contact-bright-001",
    companyId: BRIGHT_ID,
    firstName: "Lisa",
    lastName: "Cheng",
    email: "lisa.cheng@brightminds.example.com",
    phone: "+1-512-555-0411",
    type: "Admin",
    isPrimary: true,
    createdDate: "2025-03-20",
  },
  {
    id: "contact-bright-002",
    companyId: BRIGHT_ID,
    firstName: "James",
    lastName: "Ortiz",
    email: "james.ortiz@brightminds.example.com",
    phone: "+1-512-555-0412",
    type: "Billing",
    isPrimary: false,
    createdDate: "2025-05-10",
  },
  {
    id: "contact-pinnacle-001",
    companyId: PINNACLE_ID,
    firstName: "David",
    lastName: "Nakamura",
    email: "david.nakamura@pinnaclefa.example.com",
    phone: "+1-312-555-0511",
    type: "Admin",
    isPrimary: true,
    createdDate: "2024-08-05",
  },
  {
    id: "contact-pinnacle-002",
    companyId: PINNACLE_ID,
    firstName: "Emily",
    lastName: "Park",
    email: "emily.park@pinnaclefa.example.com",
    phone: "+1-312-555-0512",
    type: "Technical",
    isPrimary: false,
    createdDate: "2024-09-15",
  },
];

// ─── Usage Summaries ─────────────────────────────────────────────────────────

export const usageSummaries: UsageSummary[] = [
  {
    id: "usage-redwood-acronis-curr",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-acronis-backup-0009",
    productName: "AvePoint Cloud Backup for Microsoft 365",
    date: `${currentMonth}-15`,
    quantity: 850,
    unitPrice: 0.3,
    subtotal: 255.0,
    resourceGroup: "Backup",
  },
  {
    id: "usage-redwood-acronis-last",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    productId: "prod-acronis-backup-0009",
    productName: "AvePoint Cloud Backup for Microsoft 365",
    date: `${lastMonth}-15`,
    quantity: 810,
    unitPrice: 0.3,
    subtotal: 243.0,
    resourceGroup: "Backup",
  },
];

export const usageLines: UsageLine[] = [
  {
    id: "uline-redwood-001",
    usageSummaryId: "usage-redwood-acronis-curr",
    description: "ERP Server Backup - SAP01",
    quantity: 400,
    unitPrice: 0.3,
    subtotal: 120.0,
    date: `${currentMonth}-15`,
  },
  {
    id: "uline-redwood-002",
    usageSummaryId: "usage-redwood-acronis-curr",
    description: "CAD Server Backup - CAD01",
    quantity: 250,
    unitPrice: 0.3,
    subtotal: 75.0,
    date: `${currentMonth}-15`,
  },
  {
    id: "uline-redwood-003",
    usageSummaryId: "usage-redwood-acronis-curr",
    description: "Domain Controller Backup - DC01",
    quantity: 200,
    unitPrice: 0.3,
    subtotal: 60.0,
    date: `${currentMonth}-15`,
  },
];

// ─── Quotes ──────────────────────────────────────────────────────────────────

export const quotes: Quote[] = [
  {
    id: "quote-summit-001",
    companyId: SUMMIT_ID,
    companyName: "Summit Healthcare Partners",
    createdDate: "2026-03-10",
    expirationDate: "2026-04-10",
    status: "Sent",
    total: 1140.0,
    lineItems: [
      {
        productId: "prod-m365-e3-0003",
        productName: "Microsoft 365 E3 [New Commerce Experience]",
        quantity: 5,
        unitPrice: 36.0,
        billingTerm: "Annual",
      },
      {
        productId: "prod-aad-p1-0008",
        productName: "Microsoft Entra ID P1 [New Commerce Experience]",
        quantity: 5,
        unitPrice: 6.0,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "quote-bright-001",
    companyId: BRIGHT_ID,
    companyName: "Bright Minds Academy",
    createdDate: "2026-03-05",
    expirationDate: "2026-04-05",
    status: "Draft",
    total: 75.0,
    lineItems: [
      {
        productId: "prod-defender-biz-0007",
        productName: "Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]",
        quantity: 25,
        unitPrice: 3.0,
        billingTerm: "Monthly",
      },
    ],
  },
  {
    id: "quote-redwood-001",
    companyId: REDWOOD_ID,
    companyName: "Redwood Manufacturing",
    createdDate: "2026-02-20",
    expirationDate: "2026-03-20",
    status: "Accepted",
    total: 456.0,
    lineItems: [
      {
        productId: "prod-m365-e5-0004",
        productName: "Microsoft 365 E5 [New Commerce Experience]",
        quantity: 8,
        unitPrice: 57.0,
        billingTerm: "Annual",
      },
    ],
  },
];

// ─── Webhooks ────────────────────────────────────────────────────────────────

export const webhooks: Webhook[] = [
  {
    id: "wh-001",
    url: "https://hooks.example.com/pax8/subscriptions",
    status: "Active",
    topics: [
      "subscription.created",
      "subscription.updated",
      "subscription.cancelled",
    ],
    createdDate: "2025-06-01",
    lastTriggeredDate: "2026-03-18",
    secret: "whsec_demo_abc123",
  },
  {
    id: "wh-002",
    url: "https://hooks.example.com/pax8/invoices",
    status: "Active",
    topics: ["invoice.created", "invoice.paid"],
    createdDate: "2025-08-15",
    lastTriggeredDate: "2026-03-01",
    secret: "whsec_demo_def456",
  },
  {
    id: "wh-003",
    url: "https://hooks.example.com/pax8/orders",
    status: "Failed",
    topics: ["order.created", "order.completed"],
    createdDate: "2025-11-20",
    lastTriggeredDate: "2026-02-10",
    secret: "whsec_demo_ghi789",
  },
];

export const webhookLogs: WebhookLog[] = [
  {
    id: "whlog-001",
    webhookId: "wh-001",
    topic: "subscription.updated",
    status: "Success",
    statusCode: 200,
    triggeredDate: "2026-03-18T14:23:00Z",
    responseTime: 145,
  },
  {
    id: "whlog-002",
    webhookId: "wh-001",
    topic: "subscription.created",
    status: "Success",
    statusCode: 200,
    triggeredDate: "2026-03-15T10:12:00Z",
    responseTime: 98,
  },
  {
    id: "whlog-003",
    webhookId: "wh-002",
    topic: "invoice.created",
    status: "Success",
    statusCode: 200,
    triggeredDate: "2026-03-01T06:00:00Z",
    responseTime: 210,
  },
  {
    id: "whlog-004",
    webhookId: "wh-003",
    topic: "order.created",
    status: "Failed",
    statusCode: 502,
    triggeredDate: "2026-02-10T09:45:00Z",
    responseTime: 5023,
  },
  {
    id: "whlog-005",
    webhookId: "wh-003",
    topic: "order.completed",
    status: "Failed",
    statusCode: 0,
    triggeredDate: "2026-02-10T10:00:00Z",
    responseTime: 30000,
  },
];

// ─── Available webhook topics ────────────────────────────────────────────────

export const webhookTopics: string[] = [
  "subscription.created",
  "subscription.updated",
  "subscription.cancelled",
  "subscription.statusChanged",
  "order.created",
  "order.completed",
  "order.failed",
  "invoice.created",
  "invoice.paid",
  "invoice.overdue",
  "company.created",
  "company.updated",
  "usage.reported",
];
