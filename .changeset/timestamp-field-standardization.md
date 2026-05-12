---
"@pax8/cli": minor
"@pax8/core": minor
---

Standardize timestamp field naming across `--json` output to canonical camelCase / past-tense / ISO 8601 (`createdAt`, `updatedAt`, `expiresAt`). Implements #385 (B2 — block-launch refactor surfaced by the partner-readiness audit dim 02). Also closes #390 (F5 — `Company.created` naming).

**Migration matrix:**

| Type | Old field(s) | New field(s) |
|---|---|---|
| Company | `created`, `updatedDate` | `createdAt`, `updatedAt` |
| Order | `createdDate` | `createdAt` |
| Subscription | `createdDate` | `createdAt` |
| Quote | `createdOn`, `expiresOn` | `createdAt`, `expiresAt` |
| Webhook | `createdDate` (`updatedAt` already canonical) | `createdAt` |

**Deprecation policy:** During this minor-version cycle the `--json` output emits BOTH the old and new field names on every row, mirroring the `mrrAtRisk` → `mrrRenewing` precedent from #299. Existing `--json` consumers that read the old names keep working unchanged. The old aliases are slated for removal in **v0.3.0** and carry `@deprecated` JSDoc on the schema. New code should reference the canonical names exclusively.

**Schema-layer mechanics:** Each affected `*Schema` in `packages/core/src/api/types.ts` now wraps its object validator in a `z.preprocess()` step that accepts EITHER shape on the wire and populates BOTH names on the parsed object. The change is purely additive — new optional schema fields, no breaking changes to required ones. Demo data (`packages/core/src/mock/demo-data.ts`) keeps emitting the legacy wire shape so the preprocess code path is exercised in demo mode the same way it runs against the real API. CLI commands (`packages/cli/src/commands/`) and table/CSV column definitions reference the canonical names; the legacy aliases survive only on the `--json` output surface.

Subprocess tests (`packages/cli/src/__tests__/{companies,subscriptions,orders,quotes,webhooks.show}.test.ts`) pin that both old and new field names are present on every row of `--json` output for all five resource types. Unit tests in `packages/core/src/api/types.test.ts` pin that parsing either wire shape (legacy or canonical) produces both names on the parsed object.
