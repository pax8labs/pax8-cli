// Copyright 2026 Pax8, Inc.
// SPDX-License-Identifier: Apache-2.0

// Demo-fixture selector (#484).
//
// Picks between the hand-curated small fixture in `./demo-data.ts` (the
// default — onboarding screenshots, golden-path tests) and the generated
// large fixture in `./large-fixture.ts` (opt-in via PAX8_DEMO_SCALE=large
// — scale-matrix testing). Everything downstream (MockPax8Client and
// its callers) imports the entity arrays from this module so the switch
// is invisible above the mock boundary.
//
// The large fixture is only built when PAX8_DEMO_SCALE=large is set at
// process start — the buildLargeFixture() call is gated, so normal demo
// mode pays zero cost beyond the module load.

import * as small from "./demo-data.js";
import { buildLargeFixture } from "./large-fixture.js";

function resolveFixture(): typeof small {
  if (process.env.PAX8_DEMO_SCALE === "large") {
    // The cast is safe: buildLargeFixture returns the same shape as
    // small (same entity types), just with generated data. Empty arrays
    // for entity types not yet populated by the generator surface as
    // empty result sets at the API boundary, which is the correct
    // behavior — they don't pretend to have data they don't have.
    return buildLargeFixture() as unknown as typeof small;
  }
  return small;
}

const fixture = resolveFixture();

export const companies = fixture.companies;
export const subscriptions = fixture.subscriptions;
export const products = fixture.products;
export const invoices = fixture.invoices;
export const invoiceItems = fixture.invoiceItems;
export const orders = fixture.orders;
export const contacts = fixture.contacts;
export const usageSummaries = fixture.usageSummaries;
export const usageLines = fixture.usageLines;
export const quotes = fixture.quotes;
export const webhooks = fixture.webhooks;
export const webhookLogs = fixture.webhookLogs;
export const webhookTopicDefinitions = fixture.webhookTopicDefinitions;

// Re-export types unchanged so callers can `import { type Company } from "./fixture.js"`.
export type {
  Company,
  Subscription,
  Product,
  ProductPricing,
  Invoice,
  InvoiceItem,
  Order,
  OrderLineItem,
  Contact,
  UsageSummary,
  UsageLine,
  Quote,
  QuoteRespondedBy,
  QuoteLineItem,
  Webhook,
  WebhookLog,
  WebhookTopicDefinition,
  AmountCurrency,
  InvoiceTotals,
} from "./demo-data.js";
