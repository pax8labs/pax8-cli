// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import {
  classifyWithPsa,
  DemoConnectWiseProvider,
  findMapping,
  type PsaClassifiableDiscrepancy,
  type PsaMappingsFile,
} from "./index.js";

function discrepancy(
  overrides: Partial<PsaClassifiableDiscrepancy> = {},
): PsaClassifiableDiscrepancy {
  return {
    companyId: "company-1",
    companyName: "Summit Healthcare",
    productName: "Microsoft 365 Business Premium",
    invoicedQuantity: 12,
    activeQuantity: 10,
    delta: 2,
    dollarImpact: 40,
    ...overrides,
  };
}

const mappings: PsaMappingsFile = {
  version: "1.0",
  mappings: [
    {
      pax8CompanyId: "company-1",
      pax8ProductName: "Microsoft 365 Business Premium",
      agreementId: "agreement-1",
      additionRef: "addition-propagated",
    },
    {
      pax8CompanyId: "company-2",
      pax8ProductName: "Azure Plan",
      agreementId: "agreement-2",
      additionRef: "addition-cost-only",
    },
    {
      pax8CompanyId: "company-3",
      pax8ProductName: "Defender",
      agreementId: "agreement-3",
      additionRef: "addition-drift",
    },
    {
      pax8CompanyId: "company-4",
      pax8ProductName: "Backup",
      agreementId: "agreement-4",
      additionRef: "addition-missing",
    },
  ],
};

describe("PSA reconciliation helpers", () => {
  it("matches mappings case-insensitively and trims product names", () => {
    expect(
      findMapping(
        mappings,
        discrepancy({ companyId: "COMPANY-1", productName: "  microsoft 365 business premium " }),
      ),
    ).toMatchObject({ agreementId: "agreement-1", additionRef: "addition-propagated" });
  });

  it("classifies propagated, cost-only, psa-drift, and unmapped discrepancies", async () => {
    const discrepancies = [
      discrepancy({
        companyId: "company-1",
        productName: "Microsoft 365 Business Premium",
        invoicedQuantity: 12,
        activeQuantity: 10,
        delta: 2,
        dollarImpact: 40,
      }),
      discrepancy({
        companyId: "company-2",
        productName: "Azure Plan",
        invoicedQuantity: 8,
        activeQuantity: 6,
        delta: 2,
        dollarImpact: 60,
      }),
      discrepancy({
        companyId: "company-3",
        productName: "Defender",
        invoicedQuantity: 20,
        activeQuantity: 15,
        delta: 5,
        dollarImpact: 125,
      }),
      discrepancy({
        companyId: "company-4",
        productName: "Backup",
        invoicedQuantity: 5,
        activeQuantity: 3,
        delta: 2,
        dollarImpact: 30,
      }),
      discrepancy({
        companyId: "company-5",
        productName: "Unmapped",
        invoicedQuantity: 7,
        activeQuantity: 4,
        delta: 3,
        dollarImpact: -90,
      }),
    ];
    const provider = new DemoConnectWiseProvider([
      {
        agreementId: "agreement-1",
        additionRef: "addition-propagated",
        quantity: 12,
        unitPrice: 20,
        currency: "USD",
      },
      {
        agreementId: "agreement-2",
        additionRef: "addition-cost-only",
        quantity: 6,
        unitPrice: 30,
        currency: "USD",
      },
      {
        agreementId: "agreement-3",
        additionRef: "addition-drift",
        quantity: 99,
        unitPrice: 25,
        currency: "USD",
      },
    ]);

    const result = await classifyWithPsa(provider, discrepancies, mappings, {
      asOf: new Date("2026-03-31T00:00:00.000Z"),
      currency: "USD",
    });

    expect(result.discrepancies.map((d) => d.psa.status)).toEqual([
      "propagated",
      "cost-only",
      "psa-drift",
      "unmapped",
      "unmapped",
    ]);
    expect(result.psaSummary).toMatchObject({
      provider: "connectwise",
      asOf: "2026-03-31T00:00:00.000Z",
      coveragePercent: 60,
      counts: { propagated: 1, costOnly: 1, psaDrift: 1, unmapped: 2 },
      unmappedDollarImpact: { amount: 120, currency: "USD" },
      customerImpactTotal: { amount: 165, currency: "USD" },
    });
    expect(result.discrepancies[3].psa).toMatchObject({
      status: "unmapped",
      agreementId: "agreement-4",
      additionRef: "addition-missing",
      customerImpact: null,
    });
  });

  it("reports full coverage for an empty discrepancy set", async () => {
    const result = await classifyWithPsa(
      new DemoConnectWiseProvider(),
      [],
      { version: "1.0", mappings: [] },
      {
        asOf: new Date("2026-03-31T00:00:00.000Z"),
      },
    );

    expect(result.discrepancies).toEqual([]);
    expect(result.psaSummary.coveragePercent).toBe(100);
    expect(result.psaSummary.counts).toEqual({
      propagated: 0,
      costOnly: 0,
      psaDrift: 0,
      unmapped: 0,
    });
  });
});
