// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

export type PsaProviderName = "connectwise";

export type PsaClassificationStatus = "propagated" | "cost-only" | "psa-drift" | "unmapped";

export interface PsaMoney {
  amount: number;
  currency: string;
}

export interface PsaMapping {
  pax8CompanyId: string;
  pax8ProductName: string;
  agreementId: string;
  additionRef: string;
}

export interface PsaMappingsFile {
  version: "1.0";
  mappings: PsaMapping[];
}

export interface PsaAgreementAddition {
  agreementId: string;
  additionRef: string;
  quantity: number;
  unitPrice?: number;
  currency?: string;
  effectiveStart?: string;
  effectiveEnd?: string;
}

export interface PsaProvider {
  readonly name: PsaProviderName;
  testConnection(): Promise<void>;
  getAddition(mapping: PsaMapping, asOf: Date): Promise<PsaAgreementAddition | null>;
}

export interface PsaClassifiableDiscrepancy {
  companyId: string;
  companyName: string;
  productName: string;
  invoicedQuantity: number;
  activeQuantity: number;
  delta: number;
  dollarImpact: number;
}

export interface PsaClassification {
  status: PsaClassificationStatus;
  customerImpact: PsaMoney | null;
  agreementId: string | null;
  additionRef: string | null;
}

export interface PsaSummary {
  provider: PsaProviderName;
  asOf: string;
  coveragePercent: number;
  counts: {
    propagated: number;
    costOnly: number;
    psaDrift: number;
    unmapped: number;
  };
  unmappedDollarImpact: PsaMoney;
  customerImpactTotal: PsaMoney;
}

function mappingKey(companyId: string, productName: string): string {
  return `${companyId.toLowerCase()}\u0000${productName.trim().toLowerCase()}`;
}

export function createEmptyMappings(): PsaMappingsFile {
  return { version: "1.0", mappings: [] };
}

export function findMapping(mappings: PsaMappingsFile, discrepancy: PsaClassifiableDiscrepancy): PsaMapping | undefined {
  const wanted = mappingKey(discrepancy.companyId, discrepancy.productName);
  return mappings.mappings.find((m) => mappingKey(m.pax8CompanyId, m.pax8ProductName) === wanted);
}

export class DemoConnectWiseProvider implements PsaProvider {
  readonly name = "connectwise" as const;
  private readonly additions = new Map<string, PsaAgreementAddition>();

  constructor(additions: PsaAgreementAddition[] = []) {
    for (const addition of additions) {
      this.additions.set(addition.additionRef, addition);
    }
  }

  async testConnection(): Promise<void> {
    return;
  }

  async getAddition(mapping: PsaMapping): Promise<PsaAgreementAddition | null> {
    return this.additions.get(mapping.additionRef) ?? null;
  }
}

export class ConnectWiseProvider implements PsaProvider {
  readonly name = "connectwise" as const;

  constructor(
    private readonly credentials: {
      baseUrl?: string;
      companyId?: string;
      publicKey?: string;
      privateKey?: string;
      clientId?: string;
    },
  ) {}

  async testConnection(): Promise<void> {
    const missing = requiredConnectWiseCredentialNames().filter((name) => !this.credentials[name]);
    if (missing.length > 0) {
      throw new Error(`Missing ConnectWise PSA credentials: ${missing.join(", ")}`);
    }
  }

  async getAddition(): Promise<PsaAgreementAddition | null> {
    await this.testConnection();
    throw new Error("ConnectWise Manage live fetch is not implemented yet; use PAX8_DEMO=1 or local mappings with demo fixtures");
  }
}

export function requiredConnectWiseCredentialNames(): Array<"baseUrl" | "companyId" | "publicKey" | "privateKey" | "clientId"> {
  return ["baseUrl", "companyId", "publicKey", "privateKey", "clientId"];
}

export async function classifyWithPsa(
  provider: PsaProvider,
  discrepancies: PsaClassifiableDiscrepancy[],
  mappings: PsaMappingsFile,
  options: { asOf?: Date; currency?: string } = {},
): Promise<{ discrepancies: Array<PsaClassifiableDiscrepancy & { psa: PsaClassification }>; psaSummary: PsaSummary }> {
  const asOf = options.asOf ?? new Date();
  const currency = options.currency ?? "USD";
  const counts = { propagated: 0, costOnly: 0, psaDrift: 0, unmapped: 0 };
  let unmappedDollarImpact = 0;
  let customerImpactTotal = 0;

  const classified = [] as Array<PsaClassifiableDiscrepancy & { psa: PsaClassification }>;

  for (const discrepancy of discrepancies) {
    const mapping = findMapping(mappings, discrepancy);
    if (!mapping) {
      counts.unmapped += 1;
      unmappedDollarImpact += Math.abs(discrepancy.dollarImpact);
      classified.push({
        ...discrepancy,
        psa: { status: "unmapped", customerImpact: null, agreementId: null, additionRef: null },
      });
      continue;
    }

    const addition = await provider.getAddition(mapping, asOf);
    if (!addition) {
      counts.unmapped += 1;
      unmappedDollarImpact += Math.abs(discrepancy.dollarImpact);
      classified.push({
        ...discrepancy,
        psa: { status: "unmapped", customerImpact: null, agreementId: mapping.agreementId, additionRef: mapping.additionRef },
      });
      continue;
    }

    const psaCurrency = addition.currency ?? currency;
    const unitPrice = addition.unitPrice ?? Math.abs(discrepancy.dollarImpact / (discrepancy.delta || 1));
    const customerImpact = Math.abs(discrepancy.delta) * unitPrice;
    let status: PsaClassificationStatus;
    if (addition.quantity === discrepancy.invoicedQuantity) {
      status = "propagated";
      counts.propagated += 1;
      customerImpactTotal += customerImpact;
    } else if (addition.quantity === discrepancy.activeQuantity) {
      status = "cost-only";
      counts.costOnly += 1;
    } else {
      status = "psa-drift";
      counts.psaDrift += 1;
      customerImpactTotal += customerImpact;
    }

    classified.push({
      ...discrepancy,
      psa: {
        status,
        customerImpact: { amount: customerImpact, currency: psaCurrency },
        agreementId: addition.agreementId,
        additionRef: addition.additionRef,
      },
    });
  }

  const mapped = discrepancies.length - counts.unmapped;
  return {
    discrepancies: classified,
    psaSummary: {
      provider: provider.name,
      asOf: asOf.toISOString(),
      coveragePercent: discrepancies.length === 0 ? 100 : Math.round((mapped / discrepancies.length) * 100),
      counts,
      unmappedDollarImpact: { amount: unmappedDollarImpact, currency },
      customerImpactTotal: { amount: customerImpactTotal, currency },
    },
  };
}
