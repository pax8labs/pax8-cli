---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 orders create` and `pax8 recommendations act` now populate the spec-required `lineItemNumber` field on every outgoing line item. The public Pax8 OpenAPI's `CreateLineItem` schema declares `lineItemNumber` as required (it's a 1-based reference used by `parentLineItemNumber` to express child line items within the same order), but the CLI was omitting it entirely — every `POST /orders` payload was violating the published contract.

The fix lives in `@pax8/core`'s `OrdersApi.create()`: it auto-injects `lineItemNumber = idx + 1` on any line item that doesn't supply one, so existing embedded consumers don't have to think about the field. `OrderLineItemInputSchema` (the wire shape) now requires `lineItemNumber`; a new `OrderLineItemCreateInput` type exposes it as optional for callers, with the auto-fill happening at the boundary. Closes #331.

Spec ambiguity: the spec's canonical example (`microsoft-office-365-e3-order`) omits `lineItemNumber` even though the schema marks it required. Matching the schema is safer than matching the example — if the real API tolerates omission today, this fix is still correct (and defensive against future enforcement); if it doesn't, this unblocks single- and multi-line orders.
