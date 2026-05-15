---
"@pax8/cli": patch
"@pax8/core": patch
---

Reconcile OSS license references for consistency before publish (#434).

Fixed the one drift case where the human-readable README used "Apache 2.0" (space) while every machine-readable surface — every `package.json`'s `license` field, every SPDX header in source — uses the canonical SPDX identifier `Apache-2.0` (hyphenated). The change is one character (space → hyphen) in `README.md`, but the rationale is partner clarity: a single canonical form across every surface a partner, contributor, or automated license scanner reads.

Adds `packages/cli/src/__tests__/license-consistency.test.ts` as a regression guard, mirroring the forbidden-fields walker pattern from #315. Future PRs cannot reintroduce the non-canonical "Apache <digit>" form in any tracked file outside the verbatim `LICENSE` template and historical CHANGELOG entries.

Walked the full 12-surface audit from #434 (NOTICE, GitHub About, `pax8 --version`, `pax8 doctor`, `packages/core/README.md`, `docs/`, telemetry payloads, `.changeset/*`, generated CHANGELOG, README header badges, CI workflows, dependency licenses). Findings are in the PR description.

Dependency-license review: no GPL/AGPL/SSPL or other Apache-2.0-incompatible licenses across the dependency tree. The single `Unknown` entry (`spawndamnit`, a transitive dev-only changesets dep) ships an MIT LICENSE file; `pnpm` just can't parse its `"SEE LICENSE IN LICENSE"` field. `MPL-2.0` and `Python-2.0` entries are dev-only and compatible.

The separate coordination item — LICENSE legal sign-off (owner Courtney Norton, tracked in `docs/triage/launch-coordination.md`) — is not replaced by this change. Both must clear before publish.
