---
"@pax8/cli": minor
"@pax8/core": minor
---

**Breaking (`--json` consumers): Field naming aligned with the public Pax8 API.**

- `InvoiceItem.subtotal` → `subTotal`
- `InvoiceItem.unitPrice` → `price`
- `Company.modified` → `updatedDate`
- `Quote.expirationDate` → `expiresOn`
- `Quote.createdDate` → `createdOn`

Acceptable while pre-1.0; the CLI now uses API field names directly so partners reading both surfaces don't have to translate. The `--expiration-date` CLI flag on `pax8 quotes create` and `pax8 quotes update` is unchanged — flag vocabulary and field vocabulary are intentionally separate concerns. (refs #273)
