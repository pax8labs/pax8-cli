---
"@pax8/core": patch
---

Fix test regression introduced by #557 (opt-in caching). Two assertions in `packages/core/src/config/loader.test.ts` still expected `cache.enabled` to default to `true`, but #557 intentionally flipped the default to `false` (opt-in caching) without updating the matching test expectations. Tests now match the shipped behavior. No code change to the loader itself — the production behavior is correct, only the test was stale.

This was blocking CI on every PR opened after #557 landed, because PR build matrices evaluate the merge commit against `main` and inherit `main`'s broken test suite.
