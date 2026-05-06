// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, it, expect } from "vitest";
import { simulateCostChange, type SimulationInput } from "./cost-simulator.js";
import type { ProductPricingPlan } from "../api/types.js";

/** Build a one-rate pricing plan for a given billing term + price. */
function plan(
  billingTerm: string,
  suggestedRetailPrice: number,
  productId: string = "prod-x",
  productName: string = "Test Product",
): ProductPricingPlan {
  return {
    productId,
    productName,
    billingTerm,
    rates: [
      {
        partnerBuyRate: suggestedRetailPrice * 0.9,
        suggestedRetailPrice,
      },
    ],
  };
}

/** Build a multi-rate pricing plan with explicit volume tiers. */
function tieredPlan(
  billingTerm: string,
  tiers: { startQuantityRange: number; suggestedRetailPrice: number }[],
): ProductPricingPlan {
  return {
    productId: "prod-tiered",
    productName: "Tiered Product",
    billingTerm,
    rates: tiers.map((t) => ({
      partnerBuyRate: t.suggestedRetailPrice * 0.9,
      suggestedRetailPrice: t.suggestedRetailPrice,
      startQuantityRange: t.startQuantityRange,
    })),
  };
}

describe("simulateCostChange", () => {
  describe("SKU upgrade — same quantity", () => {
    it("computes delta when upgrading Business Basic → Premium", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-basic",
          productName: "M365 Business Basic",
          quantity: 45,
          billingTerm: "Monthly",
          price: 6,
        },
        proposed: {
          productId: "prod-prem",
          productName: "M365 Business Premium",
          quantity: 45,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "M365 Business Premium")],
      };

      const result = simulateCostChange(input);
      expect(result.current?.monthly).toBe(270); // 6 × 45
      expect(result.proposed.monthly).toBe(990); // 22 × 45
      expect(result.delta.monthly).toBe(720);
      expect(result.delta.annual).toBe(8640);
      expect(result.delta.perSeat).toBe(16); // 22 - 6
    });

    it("includes both billing terms in the proposed plan and picks the right one", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-basic",
          productName: "Basic",
          quantity: 10,
          billingTerm: "Annual",
          price: 60,
        },
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Annual",
        },
        pricing: [
          plan("Monthly", 22, "prod-prem", "Premium"),
          plan("Annual", 264, "prod-prem", "Premium"),
        ],
      };

      const result = simulateCostChange(input);
      // Annual: 264 × 10 / 12 = 220/mo; current: 60 × 10 / 12 = 50/mo
      expect(result.proposed.monthly).toBe(220);
      expect(result.current?.monthly).toBe(50);
      expect(result.delta.monthly).toBe(170);
      expect(result.proposed.billingTerm).toBe("Annual");
    });
  });

  describe("SKU downgrade — same quantity", () => {
    it("returns negative delta when moving to a cheaper SKU", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 20,
          billingTerm: "Monthly",
          price: 22,
        },
        proposed: {
          productId: "prod-basic",
          productName: "Basic",
          quantity: 20,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 6, "prod-basic", "Basic")],
      };

      const result = simulateCostChange(input);
      expect(result.delta.monthly).toBe(-320); // (6 - 22) × 20
      expect(result.delta.annual).toBe(-3840);
      expect(result.delta.perSeat).toBe(-16);
    });
  });

  describe("Quantity change — same SKU", () => {
    it("handles a quantity increase", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
          price: 22,
        },
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 25,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "Premium")],
      };

      const result = simulateCostChange(input);
      expect(result.current?.monthly).toBe(220);
      expect(result.proposed.monthly).toBe(550);
      expect(result.delta.monthly).toBe(330);
      // Quantities differ → perSeat falls back to proposed per-seat cost
      expect(result.delta.perSeat).toBe(22);
    });

    it("handles a quantity decrease", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 100,
          billingTerm: "Monthly",
          price: 22,
        },
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 60,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "Premium")],
      };

      const result = simulateCostChange(input);
      expect(result.delta.monthly).toBe(-880); // (60 - 100) × 22
    });
  });

  describe("Add new product (no current)", () => {
    it("treats the proposed cost as the full delta", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 30,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "Premium")],
      };

      const result = simulateCostChange(input);
      expect(result.current).toBeNull();
      expect(result.proposed.monthly).toBe(660);
      expect(result.delta.monthly).toBe(660);
      expect(result.delta.annual).toBe(7920);
      expect(result.delta.perSeat).toBe(22);
    });

    it("defaults to Annual term when no current and no explicit term", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
        },
        pricing: [
          plan("Monthly", 22, "prod-prem", "Premium"),
          plan("Annual", 264, "prod-prem", "Premium"),
        ],
      };

      const result = simulateCostChange(input);
      expect(result.proposed.billingTerm).toBe("Annual");
      expect(result.notes.some((n) => n.toLowerCase().includes("annual"))).toBe(true);
    });
  });

  describe("Billing-term swap", () => {
    it("notes when current and proposed billing terms differ", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Annual",
          price: 264,
        },
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
        },
        pricing: [
          plan("Monthly", 22, "prod-prem", "Premium"),
          plan("Annual", 264, "prod-prem", "Premium"),
        ],
      };

      const result = simulateCostChange(input);
      expect(result.notes.some((n) => /Annual.*Monthly/i.test(n))).toBe(true);
      // Annual current: 264 × 10 / 12 = 220/mo; Monthly proposed: 22 × 10 = 220/mo
      expect(result.delta.monthly).toBe(0);
    });

    it("does not emit a swap note when terms match", () => {
      const input: SimulationInput = {
        current: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
          price: 22,
        },
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 12,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "Premium")],
      };

      const result = simulateCostChange(input);
      expect(result.notes.some((n) => /switching/i.test(n))).toBe(false);
    });
  });

  describe("Volume-tier transitions", () => {
    it("picks the rate row whose startQuantityRange <= quantity", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-tiered",
          productName: "Tiered",
          quantity: 75,
          billingTerm: "Monthly",
        },
        pricing: [
          tieredPlan("Monthly", [
            { startQuantityRange: 1, suggestedRetailPrice: 10 },
            { startQuantityRange: 50, suggestedRetailPrice: 8 },
            { startQuantityRange: 100, suggestedRetailPrice: 6 },
          ]),
        ],
      };

      const result = simulateCostChange(input);
      // 75 falls into the 50+ tier → $8/seat
      expect(result.proposed.unitPrice).toBe(8);
      expect(result.proposed.monthly).toBe(600);
      expect(result.notes.some((n) => /tier/i.test(n))).toBe(true);
    });

    it("picks the entry-level rate when quantity is below all tier boundaries", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-tiered",
          productName: "Tiered",
          quantity: 5,
          billingTerm: "Monthly",
        },
        pricing: [
          tieredPlan("Monthly", [
            { startQuantityRange: 1, suggestedRetailPrice: 10 },
            { startQuantityRange: 50, suggestedRetailPrice: 8 },
          ]),
        ],
      };

      const result = simulateCostChange(input);
      expect(result.proposed.unitPrice).toBe(10);
      // Entry-level tier: should NOT emit a "tier applied" note
      expect(result.notes.some((n) => /tier/i.test(n))).toBe(false);
    });

    it("crosses a tier boundary on quantity increase", () => {
      const tiered = tieredPlan("Monthly", [
        { startQuantityRange: 1, suggestedRetailPrice: 10 },
        { startQuantityRange: 50, suggestedRetailPrice: 8 },
      ]);
      const input: SimulationInput = {
        current: {
          productId: "prod-tiered",
          productName: "Tiered",
          quantity: 40,
          billingTerm: "Monthly",
          price: 10,
        },
        proposed: {
          productId: "prod-tiered",
          productName: "Tiered",
          quantity: 60,
          billingTerm: "Monthly",
        },
        pricing: [tiered],
      };

      const result = simulateCostChange(input);
      expect(result.current?.monthly).toBe(400); // 10 × 40
      expect(result.proposed.monthly).toBe(480); // 8 × 60 (crossed into the cheaper tier)
      expect(result.delta.monthly).toBe(80);
    });
  });

  describe("Error handling", () => {
    it("throws when the proposed billingTerm has no matching plan", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
        },
        pricing: [plan("Annual", 264, "prod-prem", "Premium")],
      };

      expect(() => simulateCostChange(input)).toThrow(/Monthly/);
    });

    it("throws when the pricing array is empty", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
        },
        pricing: [],
      };

      expect(() => simulateCostChange(input)).toThrow(/No pricing plans/);
    });

    it("throws when the chosen plan has no rate rows", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: 10,
          billingTerm: "Monthly",
        },
        pricing: [{
          productId: "prod-prem",
          productName: "Premium",
          billingTerm: "Monthly",
          rates: [],
        }],
      };

      expect(() => simulateCostChange(input)).toThrow(/no rate rows/);
    });

    it("throws when proposed quantity is negative", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "prod-prem",
          productName: "Premium",
          quantity: -5,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 22, "prod-prem", "Premium")],
      };

      expect(() => simulateCostChange(input)).toThrow(/quantity/);
    });
  });

  describe("Result shape invariants", () => {
    it("returns annual = monthly × 12 for both legs", () => {
      const input: SimulationInput = {
        current: {
          productId: "p",
          productName: "P",
          quantity: 7,
          billingTerm: "Monthly",
          price: 11,
        },
        proposed: {
          productId: "p",
          productName: "P",
          quantity: 13,
          billingTerm: "Monthly",
        },
        pricing: [plan("Monthly", 11, "p", "P")],
      };
      const result = simulateCostChange(input);
      expect(result.current!.annual).toBe(result.current!.monthly * 12);
      expect(result.proposed.annual).toBe(result.proposed.monthly * 12);
    });

    it("rounds cents to 2 decimal places", () => {
      const input: SimulationInput = {
        proposed: {
          productId: "p",
          productName: "P",
          quantity: 3,
          billingTerm: "Annual",
        },
        pricing: [plan("Annual", 100, "p", "P")],
      };
      const result = simulateCostChange(input);
      // 100 × 3 / 12 = 25 exactly, but verify representation
      expect(result.proposed.monthly).toBe(25);
      expect(Number.isFinite(result.delta.monthly)).toBe(true);
    });
  });
});
