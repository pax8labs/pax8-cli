---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 usage list` and `pax8 usage show --lines` now hit the wire paths the Pax8 public spec actually documents. Previously `UsageApi.listSummaries` called a flat `GET /v1/usage-summaries` endpoint that does not exist (the spec only exposes the nested `GET /v1/subscriptions/{subscriptionId}/usage-summaries`), and `UsageApi.listLines` called `/v1/usage-summaries/{id}/lines` instead of the documented `/v1/usage-summaries/{id}/usage-lines`. Both bugs surfaced as 404s against the real Pax8 API.

`UsageApi.listSummaries(subscriptionId, params)` now requires a subscription ID. At the CLI surface the change is backward-compatible: `pax8 usage list --company <id|name>` continues to work and now resolves to the company's subscriptions, then iterates over each subscription's nested usage-summaries endpoint. A new `--subscription <id>` flag is available as the direct path for callers that already have a subscription ID. The `UsageSummary` schema gains an optional `subscriptionId` field, populated in demo data so the agent-facing output exposes the link from summary back to subscription.

Closes #337. Closes #212 transitively.
