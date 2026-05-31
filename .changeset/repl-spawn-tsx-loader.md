---
"@pax8/cli": patch
---

Fix the dev-mode REPL: typing any command after launching via `pnpm dev` no longer crashes the child with `ERR_MODULE_NOT_FOUND`. The REPL's spawn at `lib/repl.ts:235` hardcoded `node` even when the parent was running under `tsx`, so `cliPath` (a `.ts` source file in dev mode) was handed to a vanilla `node` that couldn't resolve TypeScript. Detect a `.ts` entrypoint and register the tsx ESM loader via Node's `--import` hook so the child resolves the same way the parent does. Also switch the spawn target from the string `"node"` to `process.execPath` so nvm / asdf / custom-node setups don't need `node` on PATH. Closes #563.

The masking effect: contributors who followed `CONTRIBUTING.md`'s documented dev workflow (`PAX8_DEMO=1 pnpm dev`) couldn't test REPL behavior locally — every typed command crashed before the dispatch handler ran. Combined with the test suite only exercising `dist/index.js`, this let dispatch-layer bugs like #561 (REPL bare-number drill-in dead) ship invisibly past CI. The dev-mode regression test added here (`runReplViaTsx` harness in `repl.integration.test.ts`) is the second layer of the contract — both invocation paths must dispatch a typed command without a module-resolution error.
