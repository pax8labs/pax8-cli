# Orders status enum — undocumented field

**TL;DR:** `pax8 orders list --status` advertised four values (`Completed, Processing, Failed, PendingManual`) that are **not declared in the public Pax8 OpenAPI**. The spec's `Order` schema has no `status` field at all, and `GET /orders` declares no `status` query parameter. The CLI was filtering on an undocumented attribute that the real API may or may not honor.

## What the spec says

Source: `https://devx.pax8.com/openapi/partner-endpoints.json`, schema fetched 2026-05-11.

- `paths."/orders".get` — query parameters are limited to pagination and `companyId`. **No `status` parameter.**
- `components.schemas.Order` — fields are `id, companyId, createdDate, isScheduled, lineItems, orderedBy, orderedByUserEmail, orderedByUserId`. **No `status` field.**

This matches the original finding in `docs/domain-review.md:241` (orders & quotes section).

## What the CLI was doing

Source: `packages/cli/src/commands/orders/list.ts` (pre-#250 fix).

```ts
.option("--status <status>", "Filter by status (Completed, Processing, Failed, PendingManual)")
// ...
if (allOpts.status) {
  params.status = allOpts.status;
}
```

The flag was forwarded into `OrdersApi.list({ status })` and from there into `Pax8Client.get("/orders", { ... status })` as a query-string parameter. The four advertised enum values appear in the demo fixtures (`MockPax8Client`) but were never traced back to a published API enum. They are **observed in the response payload**, not part of the documented contract.

The values almost certainly originate from internal Pax8 order-processing state machine output (a real `POST /orders` returns a created order whose lifecycle the marketplace tracks), but the public spec exposes none of that, and the CLI surface had no documented contract to rely on.

## What this audit changed

1. **Kept** `--status` on `orders list` to avoid breaking partner scripts that already pass it.
2. **Rewrote** the help text to honestly describe the situation: the flag forwards to the API but the spec doesn't document it, the values listed are derived from observed responses, and they may change without notice.
3. **Did not** add or remove any wire behavior. The same query parameter is sent on the same URL with the same precedence.

This is reconciliation case **G — undocumented surface** (extension of the case set in the api-version audit README §4): the CLI exposes a flag the spec does not declare, but isn't otherwise lying about wire URLs or body shape.

## Recommendation for Pax8

If `Order.status` is a real attribute returned by `GET /orders/{id}` (it is — the demo fixtures mirror the production response shape), the spec should:

1. Add `status` to `components.schemas.Order` with the actual enum (which platform should publish).
2. Add `status` as an optional query parameter on `paths."/orders".get`.

Until then, every CLI and SDK that filters orders by status is doing so against an undeclared contract. The pax8-cli surface now says so out loud.

## Cross-check: other `--status` flags audited

Performed alongside this fix (issue #250's cross-check requirement):

| Command | Spec status? | CLI help (pre-fix) | Fix |
|---|---|---|---|
| `orders list --status` | **no** | `Completed, Processing, Failed, PendingManual` | help text rewritten to flag the spec gap |
| `subscriptions list --status` | yes (10 values) | `Active, Cancelled, PendingManual, Trial, etc.` (incomplete) | help text now mirrors the full spec enum |
| `invoices list --status` | yes (6 values; query param only — `Invoice` schema doesn't redeclare it) | `Unpaid, Paid, Void, Carried` (incomplete) | help text now lists all 6 values |
| `quotes list --status` | separate spec (`quoting-endpoints.json`) | `draft, sent, accepted, declined, expired, ...` | unchanged — already lowercased to match the v2 quotes enum in #261 |
| `companies list --status` | yes (3 values) | `Active, Inactive, Deleted` | unchanged — matches spec exactly |

## Constraints honored

- READ-ONLY audit of the spec; no live API calls.
- No wire behavior changed for any command — only `--help` strings.
- All spec claims cite paths under `https://devx.pax8.com/openapi/partner-endpoints.json` (and `quoting-endpoints.json` for quotes).
