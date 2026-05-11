---
"@pax8/core": patch
---

`CompaniesApi.update` now uses PATCH instead of PUT to match the public OpenAPI contract. The public spec documents only `get` and `patch` on `/companies/{companyId}` — PUT is undocumented and would either 405 or rely on legacy aliasing. The CLI's partial-body approach is unchanged (it was always correct for PATCH semantics); only the verb on the wire moves. `pax8 companies update` UX is unaffected.
