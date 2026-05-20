---
"@pax8/cli": patch
---

`pax8 auth login --json` and `pax8 doctor --json` now honor the `--json` flag and emit a structured envelope on stdout, with human-readable banners routed to stderr per `docs/UX_GUIDE.md` §1 (stdout is data, stderr is everything else). Previously both commands wrote ANSI banners to stdout regardless of `--json`, breaking `| jq` pipelines and agent-driven invocations.

- `auth login --json` → `{ status, mode, clientIdMasked?, nextActions[] }`
- `doctor --json` → `{ checks[], summary, version, nextActions[] }`

The `nextActions[]` hints follow the §12 contract — for `doctor` they surface failure-specific recovery commands (re-auth, re-init, etc.) and a "you're clean, try the dashboard" hint on full success.

Closes #470, #471.
