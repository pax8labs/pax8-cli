---
"@pax8/cli": patch
---

Nudge partners when a newer pax8-cli version is available.

Wires `update-notifier` into CLI startup (welcome screen + command dispatch). When a newer release is on npm, the next interactive run prints a single-line nudge to stderr — never stdout — and stamps a local cache so the banner doesn't repeat until the next release lands. `ERROR_API_VALIDATION` failures additionally surface a "newer version may include a fix" hint as their first recovery step when the cache knows about an upgrade.

Opt out with `PAX8_NO_UPDATE_CHECK=1` (CI / scripted use). Demo mode (`PAX8_DEMO=1`), `--json`, `--quiet`, `PAX8_QUIET=1`, `NO_UPDATE_NOTIFIER`, `DO_NOT_TRACK=1`, CI environments, and non-TTY stderr all suppress the check automatically. Closes #183.
