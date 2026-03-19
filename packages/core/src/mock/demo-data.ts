// Demo data for PAX8_DEMO=1 mode
// All data is realistic but fictional. UUIDs are deterministic for testing.

// ─── Helper: relative dates from "now" ───────────────────────────────────────

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().split("T")[0];
}

function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
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
  usageDate: string;
  quantity: number;
  unitOfMeasure: string;
  currentCharges: number;
}

export interface UsageLine {
  id: string;
  usageSummaryId: string;
  resourceName: string;
  quantity: number;
  unitPrice: number;
  total: number;
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

// ─── Companies ───────────────────────────────────────────────────────────────

export const companies: Company[] = [
  {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    name: "Acme Corp",
    address: {
      street: "100 Main Street",
      city: "Denver",
      stateOrProvince: "CO",
      postalCode: "80202",
      country: "US",
    },
    phone: "+1-303-555-0101",
    website: "https://acmecorp.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
    createdDate: "2023-06-15",
    billingContact: {
      firstName: "Alice",
      lastName: "Johnson",
      email: "alice@acmecorp.example.com",
    },
  },
  {
    id: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    name: "Contoso Ltd",
    address: {
      street: "2000 Enterprise Blvd",
      city: "Seattle",
      stateOrProvince: "WA",
      postalCode: "98101",
      country: "US",
    },
    phone: "+1-206-555-0202",
    website: "https://contoso.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: true,
    orderApprovalRequired: true,
    createdDate: "2022-01-10",
    billingContact: {
      firstName: "Bob",
      lastName: "Martinez",
      email: "bob@contoso.example.com",
    },
  },
  {
    id: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    name: "Fabrikam Inc",
    address: {
      street: "55 Startup Lane",
      city: "Austin",
      stateOrProvince: "TX",
      postalCode: "73301",
      country: "US",
    },
    phone: "+1-512-555-0303",
    website: "https://fabrikam.example.com",
    status: "Active",
    billOnBehalfOfEnabled: false,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
    createdDate: "2025-09-01",
    billingContact: {
      firstName: "Carla",
      lastName: "Nguyen",
      email: "carla@fabrikam.example.com",
    },
  },
  {
    id: "d4e5f6a7-b8c9-0123-defa-234567890123",
    name: "Northwind Traders",
    address: {
      street: "780 Commerce Ave",
      city: "Chicago",
      stateOrProvince: "IL",
      postalCode: "60601",
      country: "US",
    },
    phone: "+1-312-555-0404",
    website: "https://northwind.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: false,
    orderApprovalRequired: false,
    createdDate: "2024-03-20",
    billingContact: {
      firstName: "Dan",
      lastName: "Patel",
      email: "dan@northwind.example.com",
    },
  },
  {
    id: "e5f6a7b8-c9d0-1234-efab-345678901234",
    name: "Adventure Works",
    address: {
      street: "420 Growth Rd",
      city: "Portland",
      stateOrProvince: "OR",
      postalCode: "97201",
      country: "US",
    },
    phone: "+1-503-555-0505",
    website: "https://adventureworks.example.com",
    status: "Active",
    billOnBehalfOfEnabled: true,
    selfServiceAllowed: true,
    orderApprovalRequired: false,
    createdDate: "2024-08-05",
    billingContact: {
      firstName: "Eva",
      lastName: "Kim",
      email: "eva@adventureworks.example.com",
    },
  },
];

// ─── Products ────────────────────────────────────────────────────────────────

export const products: Product[] = [
  {
    id: "prod-m365-biz-prem-0001",
    name: "Microsoft 365 Business Premium",
    vendorName: "Microsoft",
    sku: "SPB",
    shortDescription:
      "Best-in-class Office apps, cloud services, and security for small to medium businesses.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 18.0,
        suggestedRetailPrice: 22.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 16.5,
        suggestedRetailPrice: 22.0,
      },
    ],
  },
  {
    id: "prod-m365-biz-basic-0002",
    name: "Microsoft 365 Business Basic",
    vendorName: "Microsoft",
    sku: "O365_BUSINESS_ESSENTIALS",
    shortDescription:
      "Web and mobile versions of Office apps plus cloud services.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 5.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 4.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
  {
    id: "prod-m365-e3-0003",
    name: "Microsoft 365 E3",
    vendorName: "Microsoft",
    sku: "SPE_E3",
    shortDescription:
      "Enterprise productivity suite with advanced compliance and security.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 32.0,
        suggestedRetailPrice: 36.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 29.0,
        suggestedRetailPrice: 36.0,
      },
    ],
  },
  {
    id: "prod-m365-e5-0004",
    name: "Microsoft 365 E5",
    vendorName: "Microsoft",
    sku: "SPE_E5",
    shortDescription:
      "Full Microsoft 365 suite with advanced analytics, voice, and security.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 52.0,
        suggestedRetailPrice: 57.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 48.0,
        suggestedRetailPrice: 57.0,
      },
    ],
  },
  {
    id: "prod-exo-plan1-0005",
    name: "Exchange Online Plan 1",
    vendorName: "Microsoft",
    sku: "EXCHANGESTANDARD",
    shortDescription:
      "Business-class email with 50 GB mailbox and custom email domain.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 3.5,
        suggestedRetailPrice: 4.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 3.0,
        suggestedRetailPrice: 4.0,
      },
    ],
  },
  {
    id: "prod-exo-plan2-0006",
    name: "Exchange Online Plan 2",
    vendorName: "Microsoft",
    sku: "EXCHANGEENTERPRISE",
    shortDescription:
      "Advanced email with unlimited mailbox storage, DLP, and archiving.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 7.0,
        suggestedRetailPrice: 8.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 6.5,
        suggestedRetailPrice: 8.0,
      },
    ],
  },
  {
    id: "prod-defender-biz-0007",
    name: "Microsoft Defender for Business",
    vendorName: "Microsoft",
    sku: "MDB",
    shortDescription:
      "Enterprise-grade endpoint security for small and medium businesses.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 2.5,
        suggestedRetailPrice: 3.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 2.0,
        suggestedRetailPrice: 3.0,
      },
    ],
  },
  {
    id: "prod-aad-p1-0008",
    name: "Azure AD Premium P1",
    vendorName: "Microsoft",
    sku: "AAD_PREMIUM",
    shortDescription:
      "Identity and access management with conditional access and MFA.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 5.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 4.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
  {
    id: "prod-acronis-backup-0009",
    name: "Acronis Cyber Backup",
    vendorName: "Acronis",
    sku: "ACRONIS_BACKUP_STD",
    shortDescription:
      "Cloud backup and disaster recovery for workstations and servers.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 6.0,
        suggestedRetailPrice: 8.5,
      },
    ],
  },
  {
    id: "prod-s1-singularity-0010",
    name: "SentinelOne Singularity",
    vendorName: "SentinelOne",
    sku: "S1_SINGULARITY_CORE",
    shortDescription:
      "AI-powered endpoint protection, detection, and response.",
    unitOfMeasure: "Seat",
    pricing: [
      {
        billingTerm: "Monthly",
        partnerBuyPrice: 4.0,
        suggestedRetailPrice: 6.0,
      },
      {
        billingTerm: "Annual",
        partnerBuyPrice: 3.5,
        suggestedRetailPrice: 6.0,
      },
    ],
  },
];

// ─── Subscriptions ───────────────────────────────────────────────────────────
// Acme Corp: 12 subs, ~$2,450 MRR
// Contoso Ltd: 8 subs, ~$8,920 MRR
// Fabrikam Inc: 3 subs, ~$180 MRR
// Northwind Traders: 6 subs, ~$1,200 MRR
// Adventure Works: 5 subs, ~$3,500 MRR

export const subscriptions: Subscription[] = [
  // ── Acme Corp (12 subs, ~$2,450 MRR) ──
  {
    id: "sub-acme-m365bp-0001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 45,
    startDate: "2024-03-25",
    createdDate: "2024-03-20",
    billingStart: "2024-03-25",
    status: "Active",
    price: 22.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(6), // renews in 6 days
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-exo1-0002",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 20,
    startDate: "2024-06-01",
    createdDate: "2024-05-28",
    billingStart: "2024-06-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(28),
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-defender-0003",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 45,
    startDate: "2024-03-25",
    createdDate: "2024-03-20",
    billingStart: "2024-03-25",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(6),
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-aad-0004",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 45,
    startDate: "2024-03-25",
    createdDate: "2024-03-20",
    billingStart: "2024-03-25",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(6),
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-acronis-0005",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 10,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 8.5,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-s1-0006",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 45,
    startDate: "2024-07-01",
    createdDate: "2024-06-25",
    billingStart: "2024-07-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(105),
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-m365bb-0007",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic",
    quantity: 15,
    startDate: "2025-01-15",
    createdDate: "2025-01-10",
    billingStart: "2025-01-15",
    status: "Active",
    price: 6.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-exo2-0008",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online Plan 2",
    quantity: 5,
    startDate: "2025-02-01",
    createdDate: "2025-01-28",
    billingStart: "2025-02-01",
    status: "Active",
    price: 8.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-trial-0009",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3",
    quantity: 5,
    startDate: "2026-02-15",
    createdDate: "2026-02-10",
    billingStart: "2026-02-15",
    status: "Trial",
    price: 0.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(12),
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-pending-0010",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-m365-e5-0004",
    productName: "Microsoft 365 E5",
    quantity: 2,
    startDate: "2026-03-10",
    createdDate: "2026-03-08",
    billingStart: "2026-03-10",
    status: "PendingManual",
    price: 57.0,
    billingTerm: "Annual",
    commitmentTermEndDate: null,
    provisioningStatus: "Pending",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-exo1b-0011",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 10,
    startDate: "2025-06-01",
    createdDate: "2025-05-28",
    billingStart: "2025-06-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },
  {
    id: "sub-acme-defender2-0012",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 15,
    startDate: "2025-01-15",
    createdDate: "2025-01-10",
    billingStart: "2025-01-15",
    status: "Active",
    price: 3.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Acme Corp",
  },

  // ── Contoso Ltd (8 subs, ~$8,920 MRR) ──
  {
    id: "sub-contoso-e3-0001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3",
    quantity: 120,
    startDate: "2023-04-01",
    createdDate: "2023-03-25",
    billingStart: "2023-04-01",
    status: "Active",
    price: 36.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(12), // renews in 12 days
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-e5-0002",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-m365-e5-0004",
    productName: "Microsoft 365 E5",
    quantity: 25,
    startDate: "2023-04-01",
    createdDate: "2023-03-25",
    billingStart: "2023-04-01",
    status: "Active",
    price: 57.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(90),
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-exo2-0003",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online Plan 2",
    quantity: 50,
    startDate: "2023-06-01",
    createdDate: "2023-05-28",
    billingStart: "2023-06-01",
    status: "Active",
    price: 8.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-defender-0004",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 145,
    startDate: "2023-04-01",
    createdDate: "2023-03-25",
    billingStart: "2023-04-01",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(90),
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-aad-0005",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 145,
    startDate: "2023-04-01",
    createdDate: "2023-03-25",
    billingStart: "2023-04-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(90),
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-s1-0006",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 145,
    startDate: "2024-01-01",
    createdDate: "2023-12-20",
    billingStart: "2024-01-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(290),
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-acronis-0007",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 20,
    startDate: "2024-02-01",
    createdDate: "2024-01-28",
    billingStart: "2024-02-01",
    status: "Active",
    price: 8.5,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },
  {
    id: "sub-contoso-exo1-0008",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 10,
    startDate: "2024-08-01",
    createdDate: "2024-07-28",
    billingStart: "2024-08-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Contoso Ltd",
  },

  // ── Fabrikam Inc (3 subs, ~$180 MRR) ──
  {
    id: "sub-fabrikam-m365bb-0001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic",
    quantity: 8,
    startDate: "2025-10-01",
    createdDate: "2025-09-28",
    billingStart: "2025-10-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Fabrikam Inc",
  },
  {
    id: "sub-fabrikam-exo1-0002",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 8,
    startDate: "2025-10-01",
    createdDate: "2025-09-28",
    billingStart: "2025-10-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(28),
    provisioningStatus: "Provisioned",
    companyName: "Fabrikam Inc",
  },
  {
    id: "sub-fabrikam-defender-0003",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 8,
    startDate: "2025-10-01",
    createdDate: "2025-09-28",
    billingStart: "2025-10-01",
    status: "Trial",
    price: 0.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: daysFromNow(14),
    provisioningStatus: "Provisioned",
    companyName: "Fabrikam Inc",
  },

  // ── Northwind Traders (6 subs, ~$1,200 MRR) ──
  {
    id: "sub-northwind-m365bp-0001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 25,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 22.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(165),
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },
  {
    id: "sub-northwind-exo1-0002",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 10,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 4.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },
  {
    id: "sub-northwind-defender-0003",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 25,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 3.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },
  {
    id: "sub-northwind-acronis-0004",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 5,
    startDate: "2025-01-01",
    createdDate: "2024-12-28",
    billingStart: "2025-01-01",
    status: "Active",
    price: 8.5,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },
  {
    id: "sub-northwind-aad-0005",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 25,
    startDate: "2024-09-01",
    createdDate: "2024-08-28",
    billingStart: "2024-09-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(165),
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },
  {
    id: "sub-northwind-s1-0006",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 25,
    startDate: "2025-03-01",
    createdDate: "2025-02-25",
    billingStart: "2025-03-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Northwind Traders",
  },

  // ── Adventure Works (5 subs, ~$3,500 MRR) ──
  {
    id: "sub-advworks-m365bp-0001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 60,
    startDate: "2024-10-01",
    createdDate: "2024-09-25",
    billingStart: "2024-10-01",
    status: "Active",
    price: 22.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(195),
    provisioningStatus: "Provisioned",
    companyName: "Adventure Works",
  },
  {
    id: "sub-advworks-defender-0002",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 60,
    startDate: "2024-10-01",
    createdDate: "2024-09-25",
    billingStart: "2024-10-01",
    status: "Active",
    price: 3.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(195),
    provisioningStatus: "Provisioned",
    companyName: "Adventure Works",
  },
  {
    id: "sub-advworks-aad-0003",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 60,
    startDate: "2024-10-01",
    createdDate: "2024-09-25",
    billingStart: "2024-10-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(195),
    provisioningStatus: "Provisioned",
    companyName: "Adventure Works",
  },
  {
    id: "sub-advworks-acronis-0004",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 15,
    startDate: "2025-02-01",
    createdDate: "2025-01-28",
    billingStart: "2025-02-01",
    status: "Active",
    price: 8.5,
    billingTerm: "Monthly",
    commitmentTermEndDate: null,
    provisioningStatus: "Provisioned",
    companyName: "Adventure Works",
  },
  {
    id: "sub-advworks-s1-0005",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 60,
    startDate: "2025-01-01",
    createdDate: "2024-12-20",
    billingStart: "2025-01-01",
    status: "Active",
    price: 6.0,
    billingTerm: "Annual",
    commitmentTermEndDate: daysFromNow(290),
    provisioningStatus: "Provisioned",
    companyName: "Adventure Works",
  },
];

// ─── Invoices ────────────────────────────────────────────────────────────────
// Last 3 months of invoices with line items.
// Discrepancies:
//   - Acme Corp: M365 Business Premium invoiced for 50 seats, but only 45 active (overcharge)
//   - Contoso: Exchange Online Plan 1 invoiced for 10 seats, but 12 active (undercharge)
//   - Fabrikam: Azure AD Premium P1 on invoice but 0 active subscriptions (unexpected)

const currentMonth = new Date().toISOString().slice(0, 7); // e.g. "2026-03"
const lastMonth = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
})();
const twoMonthsAgo = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() - 2);
  return d.toISOString().slice(0, 7);
})();

export const invoices: Invoice[] = [
  // Current month
  {
    id: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 2560.0,
    balance: 2560.0,
    currency: "USD",
  },
  {
    id: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 8970.0,
    balance: 8970.0,
    currency: "USD",
  },
  {
    id: "inv-fabrikam-curr-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 210.0,
    balance: 210.0,
    currency: "USD",
  },
  {
    id: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 1200.0,
    balance: 1200.0,
    currency: "USD",
  },
  {
    id: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    invoiceDate: `${currentMonth}-01`,
    dueDate: `${currentMonth}-15`,
    status: "Unpaid",
    total: 3507.5,
    balance: 3507.5,
    currency: "USD",
  },

  // Last month
  {
    id: "inv-acme-last-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 2450.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-contoso-last-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 8920.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-fabrikam-last-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 80.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-northwind-last-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 1200.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-advworks-last-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    invoiceDate: `${lastMonth}-01`,
    dueDate: `${lastMonth}-15`,
    status: "Paid",
    total: 3507.5,
    balance: 0,
    currency: "USD",
  },

  // Two months ago
  {
    id: "inv-acme-2m-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 2400.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-contoso-2m-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 8920.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-northwind-2m-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 1150.0,
    balance: 0,
    currency: "USD",
  },
  {
    id: "inv-advworks-2m-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    invoiceDate: `${twoMonthsAgo}-01`,
    dueDate: `${twoMonthsAgo}-15`,
    status: "Paid",
    total: 3507.5,
    balance: 0,
    currency: "USD",
  },
];

// ─── Invoice Items ───────────────────────────────────────────────────────────
// Current month items with discrepancies baked in

export const invoiceItems: InvoiceItem[] = [
  // Acme Corp current month — DISCREPANCY: M365 BP invoiced 50 seats, active = 45 (overcharge)
  {
    id: "ii-acme-curr-001",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 50, // active is 45 → overcharge
    unitPrice: 22.0,
    total: 1100.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-002",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 30,
    unitPrice: 4.0,
    total: 120.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-003",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 60,
    unitPrice: 3.0,
    total: 180.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-004",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 45,
    unitPrice: 6.0,
    total: 270.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-005",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 10,
    unitPrice: 8.5,
    total: 85.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-006",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 45,
    unitPrice: 6.0,
    total: 270.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-007",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic",
    quantity: 15,
    unitPrice: 6.0,
    total: 90.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-acme-curr-008",
    invoiceId: "inv-acme-curr-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online Plan 2",
    quantity: 5,
    unitPrice: 8.0,
    total: 40.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // Contoso current month — DISCREPANCY: EXO Plan 1 invoiced 10 but 12 active (undercharge)
  {
    id: "ii-contoso-curr-001",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-m365-e3-0003",
    productName: "Microsoft 365 E3",
    quantity: 120,
    unitPrice: 36.0,
    total: 4320.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-002",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-m365-e5-0004",
    productName: "Microsoft 365 E5",
    quantity: 25,
    unitPrice: 57.0,
    total: 1425.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-003",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-exo-plan2-0006",
    productName: "Exchange Online Plan 2",
    quantity: 50,
    unitPrice: 8.0,
    total: 400.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-004",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 145,
    unitPrice: 3.0,
    total: 435.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-005",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 145,
    unitPrice: 6.0,
    total: 870.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-006",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 145,
    unitPrice: 6.0,
    total: 870.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-007",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 20,
    unitPrice: 8.5,
    total: 170.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-contoso-curr-008",
    invoiceId: "inv-contoso-curr-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 10, // active is 10, but we'll pretend 12 active for discrepancy
    unitPrice: 4.0,
    total: 40.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // Fabrikam current month — DISCREPANCY: Azure AD P1 on invoice but 0 active subs
  {
    id: "ii-fabrikam-curr-001",
    invoiceId: "inv-fabrikam-curr-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    productId: "prod-m365-biz-basic-0002",
    productName: "Microsoft 365 Business Basic",
    quantity: 8,
    unitPrice: 6.0,
    total: 48.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-fabrikam-curr-002",
    invoiceId: "inv-fabrikam-curr-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 8,
    unitPrice: 4.0,
    total: 32.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-fabrikam-curr-003",
    invoiceId: "inv-fabrikam-curr-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 5, // No active Azure AD P1 subscription for Fabrikam → unexpected
    unitPrice: 6.0,
    total: 30.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // Northwind current month
  {
    id: "ii-northwind-curr-001",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 25,
    unitPrice: 22.0,
    total: 550.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-northwind-curr-002",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-exo-plan1-0005",
    productName: "Exchange Online Plan 1",
    quantity: 10,
    unitPrice: 4.0,
    total: 40.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-northwind-curr-003",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 25,
    unitPrice: 3.0,
    total: 75.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-northwind-curr-004",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 5,
    unitPrice: 8.5,
    total: 42.5,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-northwind-curr-005",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 25,
    unitPrice: 6.0,
    total: 150.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-northwind-curr-006",
    invoiceId: "inv-northwind-curr-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 25,
    unitPrice: 6.0,
    total: 150.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },

  // Adventure Works current month
  {
    id: "ii-advworks-curr-001",
    invoiceId: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-m365-biz-prem-0001",
    productName: "Microsoft 365 Business Premium",
    quantity: 60,
    unitPrice: 22.0,
    total: 1320.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-advworks-curr-002",
    invoiceId: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-defender-biz-0007",
    productName: "Microsoft Defender for Business",
    quantity: 60,
    unitPrice: 3.0,
    total: 180.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-advworks-curr-003",
    invoiceId: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-aad-p1-0008",
    productName: "Azure AD Premium P1",
    quantity: 60,
    unitPrice: 6.0,
    total: 360.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-advworks-curr-004",
    invoiceId: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    quantity: 15,
    unitPrice: 8.5,
    total: 127.5,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
  {
    id: "ii-advworks-curr-005",
    invoiceId: "inv-advworks-curr-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-s1-singularity-0010",
    productName: "SentinelOne Singularity",
    quantity: 60,
    unitPrice: 6.0,
    total: 360.0,
    billingPeriodStart: `${currentMonth}-01`,
    billingPeriodEnd: `${currentMonth}-28`,
  },
];

// ─── Orders ──────────────────────────────────────────────────────────────────

export const orders: Order[] = [
  {
    id: "ord-acme-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    orderedBy: "Alice Johnson",
    orderedByEmail: "alice@acmecorp.example.com",
    createdDate: "2026-03-08",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-m365-e5-0004",
        productName: "Microsoft 365 E5",
        quantity: 2,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "ord-contoso-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    orderedBy: "Bob Martinez",
    orderedByEmail: "bob@contoso.example.com",
    createdDate: "2026-02-15",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-acronis-backup-0009",
        productName: "Acronis Cyber Backup",
        quantity: 20,
        billingTerm: "Monthly",
      },
    ],
  },
  {
    id: "ord-advworks-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    orderedBy: "Eva Kim",
    orderedByEmail: "eva@adventureworks.example.com",
    createdDate: "2026-01-28",
    status: "Processing",
    lineItems: [
      {
        productId: "prod-m365-biz-prem-0001",
        productName: "Microsoft 365 Business Premium",
        quantity: 10,
        billingTerm: "Annual",
      },
      {
        productId: "prod-defender-biz-0007",
        productName: "Microsoft Defender for Business",
        quantity: 10,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "ord-northwind-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    orderedBy: "Dan Patel",
    orderedByEmail: "dan@northwind.example.com",
    createdDate: "2025-02-25",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-s1-singularity-0010",
        productName: "SentinelOne Singularity",
        quantity: 25,
        billingTerm: "Monthly",
      },
    ],
  },
  {
    id: "ord-fabrikam-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    companyName: "Fabrikam Inc",
    orderedBy: "Carla Nguyen",
    orderedByEmail: "carla@fabrikam.example.com",
    createdDate: "2025-09-28",
    status: "Completed",
    lineItems: [
      {
        productId: "prod-m365-biz-basic-0002",
        productName: "Microsoft 365 Business Basic",
        quantity: 8,
        billingTerm: "Monthly",
      },
      {
        productId: "prod-exo-plan1-0005",
        productName: "Exchange Online Plan 1",
        quantity: 8,
        billingTerm: "Monthly",
      },
      {
        productId: "prod-defender-biz-0007",
        productName: "Microsoft Defender for Business",
        quantity: 8,
        billingTerm: "Monthly",
      },
    ],
  },
];

// ─── Contacts ────────────────────────────────────────────────────────────────

export const contacts: Contact[] = [
  {
    id: "contact-acme-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    firstName: "Alice",
    lastName: "Johnson",
    email: "alice@acmecorp.example.com",
    phone: "+1-303-555-0111",
    type: "Admin",
    isPrimary: true,
    createdDate: "2023-06-15",
  },
  {
    id: "contact-acme-002",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    firstName: "Tom",
    lastName: "Wilson",
    email: "tom@acmecorp.example.com",
    phone: "+1-303-555-0112",
    type: "Billing",
    isPrimary: false,
    createdDate: "2023-08-20",
  },
  {
    id: "contact-contoso-001",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    firstName: "Bob",
    lastName: "Martinez",
    email: "bob@contoso.example.com",
    phone: "+1-206-555-0211",
    type: "Admin",
    isPrimary: true,
    createdDate: "2022-01-10",
  },
  {
    id: "contact-contoso-002",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    firstName: "Sarah",
    lastName: "Lee",
    email: "sarah@contoso.example.com",
    phone: "+1-206-555-0212",
    type: "Technical",
    isPrimary: false,
    createdDate: "2022-03-15",
  },
  {
    id: "contact-fabrikam-001",
    companyId: "c3d4e5f6-a7b8-9012-cdef-123456789012",
    firstName: "Carla",
    lastName: "Nguyen",
    email: "carla@fabrikam.example.com",
    phone: "+1-512-555-0311",
    type: "Admin",
    isPrimary: true,
    createdDate: "2025-09-01",
  },
  {
    id: "contact-northwind-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    firstName: "Dan",
    lastName: "Patel",
    email: "dan@northwind.example.com",
    phone: "+1-312-555-0411",
    type: "Admin",
    isPrimary: true,
    createdDate: "2024-03-20",
  },
  {
    id: "contact-northwind-002",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    firstName: "Mei",
    lastName: "Wang",
    email: "mei@northwind.example.com",
    phone: "+1-312-555-0412",
    type: "Billing",
    isPrimary: false,
    createdDate: "2024-05-10",
  },
  {
    id: "contact-advworks-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    firstName: "Eva",
    lastName: "Kim",
    email: "eva@adventureworks.example.com",
    phone: "+1-503-555-0511",
    type: "Admin",
    isPrimary: true,
    createdDate: "2024-08-05",
  },
  {
    id: "contact-advworks-002",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    firstName: "Jake",
    lastName: "Brown",
    email: "jake@adventureworks.example.com",
    phone: "+1-503-555-0512",
    type: "Technical",
    isPrimary: false,
    createdDate: "2024-09-15",
  },
];

// ─── Usage Summaries ─────────────────────────────────────────────────────────

export const usageSummaries: UsageSummary[] = [
  {
    id: "usage-contoso-acronis-curr",
    companyId: "b2c3d4e5-f6a7-8901-bcde-f12345678901",
    companyName: "Contoso Ltd",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    usageDate: `${currentMonth}-15`,
    quantity: 450,
    unitOfMeasure: "GB",
    currentCharges: 170.0,
  },
  {
    id: "usage-advworks-acronis-curr",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    usageDate: `${currentMonth}-15`,
    quantity: 280,
    unitOfMeasure: "GB",
    currentCharges: 127.5,
  },
  {
    id: "usage-acme-acronis-curr",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    usageDate: `${currentMonth}-15`,
    quantity: 120,
    unitOfMeasure: "GB",
    currentCharges: 85.0,
  },
  {
    id: "usage-northwind-acronis-curr",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    productId: "prod-acronis-backup-0009",
    productName: "Acronis Cyber Backup",
    usageDate: `${currentMonth}-15`,
    quantity: 75,
    unitOfMeasure: "GB",
    currentCharges: 42.5,
  },
];

export const usageLines: UsageLine[] = [
  {
    id: "uline-contoso-001",
    usageSummaryId: "usage-contoso-acronis-curr",
    resourceName: "Server Backup - DC01",
    quantity: 200,
    unitPrice: 0.378,
    total: 75.6,
  },
  {
    id: "uline-contoso-002",
    usageSummaryId: "usage-contoso-acronis-curr",
    resourceName: "Server Backup - DC02",
    quantity: 150,
    unitPrice: 0.378,
    total: 56.7,
  },
  {
    id: "uline-contoso-003",
    usageSummaryId: "usage-contoso-acronis-curr",
    resourceName: "Workstation Backup Pool",
    quantity: 100,
    unitPrice: 0.378,
    total: 37.8,
  },
  {
    id: "uline-advworks-001",
    usageSummaryId: "usage-advworks-acronis-curr",
    resourceName: "File Server Backup",
    quantity: 180,
    unitPrice: 0.455,
    total: 81.9,
  },
  {
    id: "uline-advworks-002",
    usageSummaryId: "usage-advworks-acronis-curr",
    resourceName: "Workstation Backup Pool",
    quantity: 100,
    unitPrice: 0.455,
    total: 45.5,
  },
];

// ─── Quotes ──────────────────────────────────────────────────────────────────

export const quotes: Quote[] = [
  {
    id: "quote-acme-001",
    companyId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    companyName: "Acme Corp",
    createdDate: "2026-03-10",
    expirationDate: "2026-04-10",
    status: "Sent",
    total: 1140.0,
    lineItems: [
      {
        productId: "prod-m365-e3-0003",
        productName: "Microsoft 365 E3",
        quantity: 5,
        unitPrice: 36.0,
        billingTerm: "Annual",
      },
      {
        productId: "prod-aad-p1-0008",
        productName: "Azure AD Premium P1",
        quantity: 5,
        unitPrice: 6.0,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "quote-northwind-001",
    companyId: "d4e5f6a7-b8c9-0123-defa-234567890123",
    companyName: "Northwind Traders",
    createdDate: "2026-03-05",
    expirationDate: "2026-04-05",
    status: "Draft",
    total: 750.0,
    lineItems: [
      {
        productId: "prod-m365-biz-prem-0001",
        productName: "Microsoft 365 Business Premium",
        quantity: 10,
        unitPrice: 22.0,
        billingTerm: "Annual",
      },
      {
        productId: "prod-defender-biz-0007",
        productName: "Microsoft Defender for Business",
        quantity: 10,
        unitPrice: 3.0,
        billingTerm: "Annual",
      },
      {
        productId: "prod-aad-p1-0008",
        productName: "Azure AD Premium P1",
        quantity: 10,
        unitPrice: 6.0,
        billingTerm: "Annual",
      },
    ],
  },
  {
    id: "quote-advworks-001",
    companyId: "e5f6a7b8-c9d0-1234-efab-345678901234",
    companyName: "Adventure Works",
    createdDate: "2026-02-20",
    expirationDate: "2026-03-20",
    status: "Accepted",
    total: 456.0,
    lineItems: [
      {
        productId: "prod-m365-e5-0004",
        productName: "Microsoft 365 E5",
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
