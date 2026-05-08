---
"@pax8/cli": patch
---

`pax8 status` renamed to `pax8 dashboard` for clarity. The previous name collided semantically with `pax8 auth status` (an auth-credential check) and was generically named for what is actually a portfolio dashboard (top customers by MRR, urgent renewals, top recommendations). `pax8 status` is preserved as a deprecated alias that still functions identically but prints a one-line deprecation notice on stderr (`warning: \`status\` is deprecated; use \`dashboard\`. Will be removed in v1.0.`); it is hidden from `pax8 --help` so the canonical name is the only one advertised. No-change for scripts already calling `pax8 status`; new scripts and docs should prefer `pax8 dashboard`. Mirrors the parallel `--events` → `--topics` deprecation shipped on `pax8 webhooks create`.
