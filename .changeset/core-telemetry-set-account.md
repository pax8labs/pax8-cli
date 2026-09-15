---
"@pax8/core": patch
---

fix(release): publish the core APIs `@pax8/cli@0.2.0` was already built against

These landed in the source tree with #684 and #683 but shipped without a changeset, so `@pax8/core` was never versioned and the registry copy of `0.1.6` never contained them. `@pax8/cli@0.2.0` was built against the workspace core (which has them) and published with its `workspace:*` range rewritten to the stale registry `0.1.6` (which does not) — every command then failed at startup with `getTelemetry(...).setAccount is not a function` (#697).

Also includes the `partnerBuyPrice` → `partnerBuyRate` mock-fixture alignment from #680, unreleased for the same reason.
