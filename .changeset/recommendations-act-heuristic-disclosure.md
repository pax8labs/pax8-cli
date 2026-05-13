---
"@pax8/cli": patch
---

UX: `pax8 recommendations act --help` now discloses the CLI-local heuristic nature of the recommendations it operates on. Previously the disclosure existed on `pax8 recommendations list` (STAX divergence, "seat_gap" heuristic framing, provisional engine status, ARC-785/#375 sunset) but not on `act` — partners running only `act --help` weren't shown that bulk action places real orders against CLI-side heuristics, not Pax8's canonical Opportunity Explorer. Mirrors the existing disclosure pattern; no flag or behavior changes.
