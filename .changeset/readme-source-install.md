---
"@pax8/cli": patch
---

Docs: README Quick Start now leads with a working run-from-source path (`git clone` + `pnpm install` + `pnpm build` + `node packages/cli/dist/index.js`) and clearly marks `npm install -g @pax8/cli` as the post-v0.1.0 install path. Previously the documented Quick Start started with `npm install -g @pax8/cli`, which 404s because `@pax8/cli` is not yet published — every first-time visitor hit a dead-end on the first command. The README Status section now carries a pre-release callout linking to the source-install steps. Closes #257.
