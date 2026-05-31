---
"@pax8/cli": patch
"@pax8/core": patch
---

Pre-launch scrub: remove internal Pax8 system references that #461/#489 missed. No behavior change; only comments, help text, and one private URL.

- **Internal Jira-style ticket prefixes** (`ARC-`, `PAE-`, `PAM-`) — present in user-facing `--help` text on `pax8 recommendations list / act` and `pax8 clients create`, plus a dozen code comments across `packages/cli` and `packages/core`. Partners running `--help` saw "ARC-785" / "PAM-997" with no context; rewrote the text to be self-contained (e.g. "Pax8's first-party Opportunity Explorer API ships" instead of "ARC-785, `GET /opportunities`"). The companion test assertion in `companies.test.ts` that checked for `"PAM-997"` in `--help` output now checks for `"Pax8 API Reference"` to match the new wording.
- **Reviewer names** (`Cassie`) — leaked through into source comments and one changeset; replaced with generic "domain review" / "partner walkthrough" framing.
- **Private Atlassian URLs** — `packages/core/src/api/types.test.ts` had two `pax8.atlassian.net` links in its preamble (Marketplace Data Risk Tiering doc, CLI Domain Review approval doc). Public viewers would 403; replaced with paraphrased descriptions.
- **Stale doc reference** — `docs/pm-review-response-2026-05.md` cited in `types.test.ts` doesn't exist in the repo. Removed.

Historical per-package CHANGELOGs (`packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`) deliberately left alone — they're append-only release-note records.
