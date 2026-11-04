---
"@pax8/core": minor
"@pax8/cli": minor
---

Upgrade Zod to version 4 to address the dependency audit finding. Preserve nested configuration defaults with `prefault`, update validation error formatting for Zod 4 issue codes, and type pagination schemas by their parsed output. Consumers passing Zod schemas to the core client must use Zod 4.

Upgrade the Vite validation toolchain and source-map-js dependency to patched versions so the high-severity CI audit passes.
