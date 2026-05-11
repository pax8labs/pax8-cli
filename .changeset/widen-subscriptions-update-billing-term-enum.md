---
"@pax8/cli": minor
---

Feature: `pax8 subscriptions update --billing-term` now mirrors the Pax8 API request-body enum at `PUT /subscriptions/{subscriptionId}`. Accepted values: `Monthly | Annual | 2-Year | 3-Year | One-Time | Trial | Activation`. Previously the CLI's help text advertised only `Monthly or Annual` — a hand-curated subset that didn't reflect the actual API surface; values outside that subset already worked but were undocumented.

The CLI now also fail-fasts on values outside the API enum (typos, case-mismatched `annual`, etc.) with a clean `ERROR_INVALID_INPUT` listing the canonical accepted set — giving users a CLI-side error instead of an opaque API rejection.

The existing commitment pre-flight check from #293 is unchanged: mid-commitment billing-term changes still block at the CLI layer with the actionable recovery message. Vendor-specific acceptance (e.g., a particular vendor not honoring `2-Year`) is deliberately left to the API to surface — the CLI mirrors what's available; the API surfaces what's rejected.

Source-of-truth for the enum: `docs/triage/billing-term-update-enum.md` (verified against `https://devx.pax8.com/openapi/partner-endpoints.json` on 2026-05-11).
