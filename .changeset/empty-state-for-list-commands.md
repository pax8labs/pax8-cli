---
"@pax8/cli": patch
---

List commands now render a helpful empty-state message when a filter matches zero rows, instead of an empty header-and-divider table that read as "broken." Affects `companies list`, `subscriptions list`, `invoices list`, `invoices items`, `orders list`, `products list`, `contacts list`, `quotes list`, `quotes line-items list`, `usage list`, `webhooks list`, `webhooks topics list`, and `webhooks logs`.

The new `emptyState` parameter on `output()` (`headline` + optional `reasons` + optional `suggestions`) renders on stderr when `format === "table"` and the data array is empty, preserving the stdout-is-data / stderr-is-everything-else split. `--json` still emits `[]`, `--csv` still emits the header row, `--ids-only` still emits nothing — every agent and pipeline contract is unchanged. Closes #197.
