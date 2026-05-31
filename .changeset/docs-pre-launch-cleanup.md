---
"@pax8/cli": patch
---

Pre-launch documentation cleanup, no code changes:

- **`README.md`** — restructured Quick Start into explicit "Install / Run / Authenticate" steps with three documented invocation paths (`node dist/index.js`, `npm link`'d `pax8`, `pnpm dev`); de-duplicated the pre-release banner (was repeated three times); expanded the Commands section to surface `contacts`, `quotes`, `webhooks`, `usage`, `config`, `report`, `init`, `completions`, `version`, `report-bug`, `telemetry` (the existing surface but only the prominent commands were documented); fixed the `report mrr` / `report growth` paragraph that still said "v0.2 reporting work will rebuild" when `pax8 report renewals|concentration|subscriptions` already shipped; rebuilt the REPL Mode section to show the welcome banner and document `back` / `n` / `p` shortcuts; replaced the Documentation section's BUILD.md link with current contributor / partner-facing pointers.
- **`SUPPORT.md`** — added `pax8 version` and `PAX8_DEMO=1` reproduction tips to "Try first".
- **`CHANGELOG.md`** — converted the root file from a duplicate-of-truth into a pointer to the changesets-managed per-package CHANGELOGs (`packages/cli/CHANGELOG.md`, `packages/core/CHANGELOG.md`). The v0.1.0 release entry stays for archaeology; the unmaintained "Unreleased" section that was lagging behind 0.2.x / 0.3.0 is gone.
- **`docs/BUILD.md` → `docs/history/BUILD.md`** — moved the autonomous-build prompt out of the user-facing docs path. Added a "Historical document" banner explaining what it is. Updated the two references in `CLAUDE.md`.
- **`docs/release/CHECKLIST.md`** — new working doc for the public OSS launch, structured by phase (decisions, code/test gates, infra, release mechanics, comms, post-launch ops). The release plan lives in chat-transcript context; this file is the executable form.
