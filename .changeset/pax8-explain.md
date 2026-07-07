---
"@pax8/cli": patch
"@pax8/core": patch
---

New `pax8 explain <term>` — a built-in glossary of Pax8 CLI and marketplace terminology.

UXR F8 (#656): partners were leaving the workflow to look up terms like *seat gap*, *MRR uplift*, and *orderable*. Andrew explicitly suggested `pax8 explain seat-gap` as the recovery. Ships as a fully local command — no API call, no auth, no config — so it works even without credentials or in demo mode.

**Surface:**

```
pax8 explain seat-gap                # look up a term
pax8 explain "opportunity type"       # spaces work
pax8 explain seat_gap                 # aliases and case-insensitive
pax8 explain --list                   # browse every term, grouped by category
pax8 explain <bad-term>                # exits 1; stderr suggests nearest matches
```

Both text and `--json` output. Missing terms exit 1 with `ERROR_TERM_NOT_FOUND` (new machine-readable code) and up to three fuzzy-matched suggestions.

**v1 covers 15 terms** grouped into recommendation, subscription, billing, product, and operational categories — drawn from wording that already appears in user-facing CLI output, so every entry solves a "wait, what does that mean?" moment partners can actually hit today.

**Also lands a small reusable fuzzy matcher** (Levenshtein + `suggest()`) in `packages/cli/src/lib/fuzzy.ts` — the first fuzzy helper in the repo, useful for any future did-you-mean recovery path. Guarded with a length-band pre-filter so it stays cheap on larger candidate sets.

Closes #656.
