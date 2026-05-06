// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

export { getUpcomingRenewals, type RenewalItem, type RenewalReport } from "./renewal-tracker.js";
export { auditInvoices, type AuditDiscrepancy, type AuditReport } from "./invoice-auditor.js";
export { subscriptionMrr, computeMrr, computeGrowth, type MrrReport, type GrowthReport } from "./analytics.js";
export { FileCache } from "./cache.js";
export { executeBulk, type BulkOp, type BulkResult } from "./bulk-executor.js";
export { getRecommendations, getPortfolioCoverage, categorizeProduct, ALL_CATEGORIES, type Recommendation, type RecommendationReport, type CompanyCoverage, type ProductCategory } from "./recommendations.js";
export {
  simulateCostChange,
  type SimulationCurrent,
  type SimulationProposed,
  type SimulationInput,
  type SimulationLeg,
  type SimulationDelta,
  type SimulationResult,
} from "./cost-simulator.js";
