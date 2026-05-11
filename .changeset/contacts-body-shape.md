---
"@pax8/core": minor
"@pax8/cli": minor
---

`pax8 contacts {create,update}`: align request bodies with the public OpenAPI contract.

- `types` is now `Array<{type, primary}>` per the spec's `ContactType` object schema (was `string[]` of kind enums). The `--type` CLI flag still accepts comma-separated kind names (`Admin,Billing,Technical`); each entry is inflated to `{type, primary: false}` at handler time.
- `--phone` is now required on `contacts create` — the spec marks it required, and a spec-strict server 422s without it.
- `contacts update` now fetch-then-merges the current contact before sending so the spec's PUT body invariants (`firstName`, `lastName`, `email`, `phone` all required) are satisfied even when the user passes a single field.
- `companyId` is no longer carried in the request body — the spec puts it in the URL path (`/v1/companies/{companyId}/contacts[/{contactId}]`) only.

A new `ContactTypeKind` type (the bare `"Admin"|"Billing"|"Technical"` enum) is exported from `@pax8/core` alongside the reshaped `ContactType` object type, so embedded consumers can keep validating kind names independently of the wire shape.

Closes #325.
