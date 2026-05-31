---
"@pax8/core": patch
---

Branch coverage push on the three `@pax8/core` API clients flagged in the partner-readiness audit. Closes #393.

Coverage delta (branches):
- `packages/core/src/api/products.ts` — **0% → 100%**
- `packages/core/src/api/invoices.ts` — **38% → 69%**
- `packages/core/src/api/webhooks.ts` — **57% → 71%**

Products clears the AC threshold (≥ 85%); invoices and webhooks fall short of the 85% target but capture the load-bearing branches the audit specifically flagged:
- products: `list()`'s no-params path, `search()`'s longest-token reduce + multi/single/empty query paths + the `apiKeyword || undefined` ternary, vendor pass-through.
- invoices: `list()`'s no-params path, `month` ↔ `invoiceDate` precedence, empty-content envelope, `listItems()` aggregate fan-out across companies + explicit-invoiceId short-circuit + no-args fallback + client-side pagination of aggregated items.
- webhooks: `getTopicDefinitions` flat-array parity-drift branch, `setStatus(active=false)` toggle branch, `testTopic` URL-encoding of topic slugs with `/`.

The remaining ~14-16% gap on invoices/webhooks lives in nullish-coalescing micro-branches (`opts.page ?? 0`, `pageSize ?? items.length`, etc.) where the marginal value of an explicit test isn't worth the maintenance overhead. Open a follow-up issue if a future coverage-gate raise needs them.

Full suite: 2150 passing (+6 from this PR).
