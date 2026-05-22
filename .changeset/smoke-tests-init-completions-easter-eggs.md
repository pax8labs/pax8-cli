---
"@pax8/cli": patch
---

Add subprocess smoke coverage for `pax8 init`, `pax8 completions`, and the `coffee` / `moo` easter eggs — the four CLI surfaces previously listed in the partner-readiness audit as having zero test references. Closes #395.

`packages/cli/src/__tests__/smoke-misc.test.ts` (new file, 9 tests):
- `init` — `--help` output, default-config creation in a tmp `PAX8_CONFIG_DIR`, `--demo` / `--demo off` toggle round-trip via the on-disk config file.
- `completions` — bash + zsh script generation, plus the `--help` smoke.
- `coffee` — asserts the final "Your coffee is ready" line lands on stdout (the 6-second progress-bar simulation runs end-to-end; per-test timeout bumped to 15s rather than globally so the rest of the smoke suite stays fast).
- `moo` — asserts the ASCII cow's `(oo)` fingerprint + the quoted fortune-line pattern.

`time-quip` is an internal helper (no command surface) and isn't covered here — it's already exercised indirectly by the welcome-screen tests. `report-bug` was on the original issue list but already had thorough coverage in `report-bug.test.ts`; no additions needed.

Full suite: 2144 passing (+9 from this PR).
