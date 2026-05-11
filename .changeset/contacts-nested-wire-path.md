---
"@pax8/core": patch
"@pax8/cli": patch
---

Fix: `pax8 contacts` commands now target the documented nested API paths under `/v1/companies/{companyId}/contacts/*`. Previously `ContactsApi.{get,create,update,delete}` called flat `/v1/contacts/*` endpoints that do not exist in the Pax8 public spec; the public OpenAPI definition only addresses contacts via `/v1/companies/{companyId}/contacts[/{contactId}]`.

**Breaking change at the CLI surface** for `contacts show`, `contacts update`, and `contacts delete`: each now requires `--company <id|name>` because the spec has no flat per-contact lookup. The CLI emits a clear migration error when `--company` is missing. `contacts list` and `contacts create` already required `--company`, so their surface is unchanged. Body-shape bugs surfaced in the same audit (#325) are intentionally out of scope for this PR.

Closes #324.
