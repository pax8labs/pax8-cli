---
"@pax8/cli": patch
---

Sharpen pricing surfaces across `subscriptions` and `products show`.

UXR F9 (#657): partners couldn't tell whether the `Price` column showed their partner cost or the customer-facing MSRP, and a missing wire `price` rendered as `$0.00` or the misleading `-$0.00`. Three human-readable output changes ship together — the `--json` shape on all four commands is unchanged.

- **`subscriptions list` / `show` / `update`**: the `Price` column and detail label are now `Partner Price` so the meaning is explicit at a glance.
- **`subscriptions show` / `update` / `cancel`**: a missing wire `price` (null, undefined, or NaN) renders as a dim em-dash (`—`) instead of `$0.00` / `-$0.00`. A real `0` still renders `$0.00` — the em-dash only stands in for "we don't have a value from the API."
- **`products show --pricing`**: the table gains a new `Margin` column derived from the first rate entry so partners can compare cost vs MSRP inline.

Scripts and integrations that parse the human table output (labels or column counts) will see these shifts — the ensemble reviewer flagged this on the PR. `--json` is the stable contract and unchanged; steer any automation that keys off row labels toward `--json`.

Closes #657.
