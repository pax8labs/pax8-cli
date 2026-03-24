# Changelog

## Unreleased

### Features
- **Portfolio coverage analysis** — `pax8 companies list --coverage` shows category coverage (N/7), missing categories, and estimated MRR uplift per company (#64)
- **MRR and growth reporting** — `pax8 report mrr` and `pax8 report growth` commands with full JSON/CSV/quiet support (#36)
- **nextActions in JSON output** — status, renewals, recommendations, and audit commands include contextual next-step suggestions for agents (#69)
- **Claude skill error handling** — structured error responses with recovery suggestions instead of raw stderr (#68)
- **Zero-subscription company flagging** — recommendations engine flags companies with no active subscriptions (#52)
- **MRR impact after orders** — order creation shows unit price, monthly cost, and annual cost (#57)
- **Test mode** — `PAX8_TEST=1` or `pax8 init --test` runs against adversarial edge-case data (#67)
- **Cache bypass** — `--refresh` flag skips API cache for fresh data (#73)
- **Real API integration tests** — `pnpm test:real` runs read-only tests against live Pax8 API when credentials are set (#38)
- **Credential setup guide** — step-by-step docs for API credential configuration (#41, #42)

### Fixes
- **Invoice auditor** — correctly aggregates quantities when a company has multiple subscriptions for the same product (#63)
- **Recommendations summary counts** — visible item counts now match what's actually displayed (#51)
- **MRR uplift estimates** — labeled as upper-bound projections, not forecasts (#72)
- **Product matching** — fuzzy matching and vendor-aware fallback for catalog name changes (#71)
- **Subscription truncation warning** — warns when results hit page size limit (#61)
- **Windows credential permissions** — enforces file permissions via `icacls` on Windows, adds doctor check (#34)
- **Table output** — terminal-width-aware word wrap, verified no ANSI leakage in JSON/CSV (#37)

### Performance
- **Mock client delays** — reduced from 50-200ms to 5-20ms in demo mode, zero in test/CI mode (#74)

### Internal
- **Centralized MRR helper** — single `subscriptionMrr()` function replaces 4 duplicates (#53, #70)
- **Consistent `formatQuantity()`** usage across commands (#56)
