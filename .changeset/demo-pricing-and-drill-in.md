---
"@pax8/cli": patch
---

fix(pricing): report Pax8 cost at partnerBuyRate, and make `recommendations why`/`email` work when piped (#711, #715)

**Every "Pax8 cost" figure in demo mode was retail.** The demo fixture set `subscription.price` from `suggestedRetailPrice` rather than `partnerBuyRate` — so `dashboard`, `report *`, `today`, and `clients more` all reported what the *customer* pays rather than what the *partner* pays Pax8, which is what those commands claim to measure. 23 subscriptions repriced. Portfolio monthly cost on the demo fixture moves from $1,760.41 to $1,354.10. Non-USD and zero-price rows are handled separately: the GBP row keeps its currency ratio rather than being flattened to a USD rate.

Demo mode is the test posture and the screenshot/demo surface, so this is what every golden-path test, README figure, and recorded demo has been showing.

**Two production code paths were on the wrong basis too**, and the reprice is what exposed them — with a retail-priced fixture both sides agreed, so nothing looked wrong:

- `simulateCostChange` priced `proposed` from `suggestedRetailPrice` while `current` came from the subscription's own price. Once the fixture was corrected the two sides of the comparison were on different bases: a Business Basic → Premium swap reported **+$425/mo** where the real Pax8 cost delta is **+$325/mo**.
- The recommendations engine priced `estimatedMrrUplift` from retail. Fixing it required widening `getRecommendations`'s public signature, which only ever accepted `suggestedRetailPrice` — the engine had no access to the buy rate at all.

Both fall back to `suggestedRetailPrice` when a rate row carries no buy rate, so embedders on the older shape keep working; the resulting figure is then retail and overstates cost.

**`recommendations why <n>` and `email <n>` could never work for a non-interactive caller.** They resolve `<n>` through a cache that `recommendations list` wrote **only in its table-render path** — and `getOutputFormat()` returns `"json"` whenever stdout isn't a TTY. So the cache was written interactively and never for a pipe, a script, or an agent, and every such invocation failed with "No cached recommendations found". Not flaky: broken by construction for every non-interactive caller. The write now happens on both paths.

**Test-design note.** The cost-simulator unit fixtures derived `partnerBuyRate = suggestedRetailPrice × 0.9`, which meant every test asserting tier selection or delta arithmetic *also* silently asserted which pricing basis the simulator reads — one behaviour change broke twelve unrelated tests. The generic helpers now carry the same figure in both rates so each test asserts one thing, and the basis is covered by two dedicated tests: one that the buy rate wins when both are present, one that the retail fallback still works.

Two invariant assertions (`arrRenewing ≈ mrrRenewing × 12`, `annualCost ≈ monthlyCost × 12`) were bounded at ±0.05, which only held while every fixture price was a whole number. Both aggregates are derived from unrounded monthly figures and then rounded, so they can differ by up to `12 × 0.005`. Now bounded at that derivation plus a float epsilon.
