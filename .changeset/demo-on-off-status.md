---
"@pax8/cli": patch
---

Add `pax8 demo on|off|status` for persistent demo-mode toggle.

Mirrors the `pax8-cta demo on` pattern so partners can use the same mental model across both Pax8 CLIs. Persists to `~/.pax8/config.yaml` (`demo: true|false`) so demo state survives across `npx` invocations.

`PAX8_DEMO` env var still wins when set — `pax8 demo status` shows which source determined the current state and warns when env will override config. Closes #594.
