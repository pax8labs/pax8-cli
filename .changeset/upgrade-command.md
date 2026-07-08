---
"@pax8/cli": minor
---

feat(upgrade): add `pax8 upgrade` self-updater with install-method detection

New `pax8 upgrade` command checks the npm registry for a newer `@pax8/cli`, detects how the CLI was installed (npm/pnpm/yarn global, Homebrew, or npx), and runs the matching upgrade command after confirmation. `pax8 upgrade --check` reports current vs latest without installing, and `--json` emits a machine-readable envelope (`{ current, latest, upToDate, installMethod, upgradeCommand, upgradeArgs, action }`). The periodic "new version available" nudge and the drift-aware `ERROR_API_VALIDATION` recovery hint now point at `pax8 upgrade` instead of a hardcoded `npm i -g`.
