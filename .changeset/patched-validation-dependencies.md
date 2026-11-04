---
"@pax8/core": minor
"@pax8/cli": minor
---

Breaking change: upgrade Zod to version 4 to address the dependency audit finding. Consumers passing Zod schemas to the core client must use Zod 4. This ships as a minor release while the packages are pre-1.0.

Preserve nested configuration defaults with `prefault`, use Zod's default validation messages with field paths instead of custom per-code formatting, and type pagination schemas by their parsed output. Human-readable validation errors no longer include raw Zod issue-code tokens; structured CLI error codes stay unchanged.

Upgrade the Vite validation toolchain and source-map-js dependency to patched versions so the high-severity CI audit passes.
