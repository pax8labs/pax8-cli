---
"@pax8/core": patch
"@pax8/cli": patch
---

`pax8 companies create` and `pax8 companies show` (and every other read that surfaces `address`) now align with the public Pax8 spec:

- **`AddressSchema` rename (closes #327, #328):** wire field names are now `stateOrProvince` and `postalCode` (previously `state` and `zip`). The CLI flag names `--state` and `--zip` are unchanged for UX continuity — flag vocabulary and wire vocabulary are intentionally separate. Pre-rename, the wrong leaf names silently (a) dropped state/postal data on `companies create` (the API didn't recognize them) and (b) dropped state/postal data on every read (Zod stripped the API's `stateOrProvince` / `postalCode` as unknowns).
- **Three required billing booleans (closes #329):** `companies create` now sends `billOnBehalfOfEnabled`, `selfServiceAllowed`, and `orderApprovalRequired` via new `--bill-on-behalf-of`, `--self-service-allowed`, `--order-approval-required` flags (all default to `false`, matching the conservative shape in the OpenAPI `company-post` example). `CreateCompanyInputSchema` now requires the three booleans at the type level.
- **Fail-fast on empty address (closes #329):** the handler no longer constructs a degenerate empty `address` object on the wire when partners omit address flags. It throws `ERROR_INVALID_INPUT` with a structured error pointing at the spec's `address` requirement.
- **New `--street` flag** on `companies create` for the spec's `address.street`.

Demo fixtures and the mock client are renamed to match. Read-side rendering in `companies show` now reads from `address.stateOrProvince` and `address.postalCode`.
