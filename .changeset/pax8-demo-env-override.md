---
"@pax8/cli": patch
---

`PAX8_DEMO=false` / `PAX8_DEMO=0` now correctly overrides `demo: true` in `~/.pax8/config.yaml`, letting users keep demo as a safe default while opting into the real API per-invocation. Previously the env var could only force demo ON; force-OFF required editing config.

Centralizes the precedence logic into a single `resolveDemoMode(config)` / `resolveDemoModeAsync()` helper in `lib/context.ts` and updates the four sites that previously had inline copies with subtly different behavior:

- `buildContext()` — what command code sees as `ctx.isDemo`
- `pax8 doctor` — auth check + diagnostic body
- The top-level `✨ Demo mode — showing sample data` banner
- The telemetry `isDemo` event tag

Truthy env values (`1`, `true`) and falsy values (`0`, `false`) take precedence over config in either direction; an unset env var defers to `config.demo`.
