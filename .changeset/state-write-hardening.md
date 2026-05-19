---
"@pax8/cli": patch
"@pax8/core": patch
---

Four interlocking fixes to local-state files written by the CLI:

1. **`PAX8_CONFIG_DIR` routing.** `idempotency.ts`, `dispute.ts`, the REPL pending-actions reader/writer in `repl.ts`, the writers in `companies/list.ts` and `recommendations/list.ts`, and the `init` command's error recovery text all hardcoded `path.join(homedir(), ".pax8")` (or read it via a dynamic `await import("os")` to dodge top-level greps). They now go through `getConfigDir()`, which honors `PAX8_CONFIG_DIR` and stays in sync between readers and writers. The `init` recovery hint renders the resolved path and tells the user how to point at a different root.

2. **Safe-write `0o600` + `O_NOFOLLOW`.** `last-list.ts`, the REPL `pending-actions.json` writes, the tmp-file step in `dispute.ts` and `idempotency.ts`, and `mock-client.ts`'s `demo-orders.json` writes all wrote via `fs.writeFile` / `writeFileSync`. Under the default umask this left partner-tenant business data world-readable on shared hosts and would follow an attacker-placed symlink at the destination. They now go through `safeWriteFileSync`.

3. **Repo-wide policy gate (`local-state-writers.test.ts`).** A vitest regression test enforces both rules across `packages/cli/src/` — no direct `os.homedir()`, no raw `writeFileSync` / `fs.writeFile` outside an explicit allow-list. Future state-file additions can't slip past.

4. **Test hermeticity.** `loader-extended.test.ts` previously created `~/.pax8` on the contributor's real home while exercising the default-path code path; it now stubs `os.homedir()` to a tmpdir per test. New `vitest.real-home-guard-setup.ts` snapshots `~/.pax8` before tests run and asserts the post-suite filesystem is unchanged — any test that mutates the real home now fails CI explicitly. This guard caught a pre-existing bug in `MockPax8Client.OrdersResource` (writes to `~/.pax8/demo-orders.json` ignored `PAX8_CONFIG_DIR`), fixed in this PR.

**Behavioral note:** demo-mode `demo-orders.json` now lives at `${PAX8_CONFIG_DIR}/demo-orders.json` instead of `~/.pax8/demo-orders.json`. Existing users with persisted demo state under `~/.pax8` will appear to have a fresh demo on first run after upgrade.

Follow-up tracked in #504: `credential-store.ts` has the same architectural defect; its unit tests mock `fs.*` so the home-guard doesn't see the leak, but the fix belongs alongside this batch.

Closes #458, #469, #475, #459.
