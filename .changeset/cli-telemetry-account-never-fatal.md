---
"@pax8/cli": patch
---

fix(telemetry): never let account attribution take down a command (#697)

`resolveTelemetryAccount()` called `getTelemetry().setAccount()` again from its own `catch` block, so when the resolved `@pax8/core` predated that method the fallback threw too and the `preAction` hook rejected — turning a best-effort telemetry detail into a fatal error on every single invocation, including demo mode. The call is now optional (`setAccount?.()`) and independently guarded, matching the "never block the CLI on telemetry init" contract already used by `loadEnabled()`.

Adds `pnpm test:smoke`, which installs the packaged CLI into a clean temp directory — so `@pax8/core` resolves from the registry rather than the workspace link — and runs the README demo commands end to end. That resolution difference is what hid this regression from the existing suites.
