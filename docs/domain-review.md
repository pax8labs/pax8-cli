# Pax8 CLI — Domain Review

> **Purpose:** This document captures every command, flag, and output field the Pax8 CLI exposes, mapped against the public Pax8 API at devx.pax8.com. It's structured so each domain owner inside Pax8 can review only the section relevant to their domain (10–15 minutes per section) and confirm the CLI's naming and structure matches how their team talks about that domain.
>
> **Review prompt:** For each domain, please answer:
> 1. Do the command names, subcommand structure, and flag names match how you and your team talk about this domain?
> 2. For computed surfaces (renewals, invoice audit, recommendations, etc.): are these ones you're comfortable having external partners and agents depend on as a public contract?
> 3. Is anything missing or named in a way that would surprise a partner?
>
> **How to comment:** Add inline comments on the specific row/line you're flagging, or use the comments at the bottom of the page.

## How to use this document

- Skip to your domain section via the table of contents below.
- Each section is self-contained — you don't need to read others to review yours.
- Computed surfaces (logic the CLI invents on top of the API) are called out explicitly because the API docs don't constrain them.
- "API" in tables refers to the public docs at devx.pax8.com. "CLI" refers to the `pax8` command-line tool published from this repo.

## Table of Contents

1. Companies & Contacts
2. Subscriptions & Renewals
3. Invoices & Billing
4. Orders & Quotes
5. Products & Catalog
6. Recommendations
7. Webhooks & Events
8. Reporting & Analytics
9. Workflows
10. Cross-cutting Concerns
11. Appendix — Methodology

## Summary of Concerns

Five themes were flagged for domain-owner attention. After the 2026-05-07 merges (#252–#267) the picture is materially better; the items below carry their post-merge status.

**(1) Invented `InvoiceStatus` enum — RESOLVED in #260.** The CLI no longer invents `Carry` and `Nothing`. The enum is now `Unpaid`, `Paid`, `Void`, `Carried` and the schema field is optional, matching the OpenAPI spec example. `Overdue` was removed as a filter alias. Pending follow-up: a docs ticket against the Pax8 OpenAPI to formally add `status` to `Invoice.properties` (it's on the wire today, just absent from the `partner-endpoints` schema).

**(2) Computed surfaces still need domain-owner blessing — UNCHANGED.** Five computed surfaces (`subscriptions renewals`, `invoices audit`, `recommendations list`/`act`, `report mrr`/`growth`, `cost sim`) implement domain logic that has no API equivalent and no documented spec. Partners depending on these depend on logic that lives only in this repo. See the new "Public-blessed tier list" in Cross-cutting Concerns for how this is now framed.

**(3) `commitmentTermEndDate` and `renewalDate` renames — UNCHANGED.** The CLI still normalizes `subscription.commitmentTerm.endDate` into a top-level `commitmentTermEndDate` and renames it `renewalDate` in the renewals view. Still needs a domain-owner call on canonical vocabulary.

**(4) Quotes v1-shaped over v2 endpoint — PARTIALLY ADDRESSED.** #261 surfaces accept/decline workflow fields (`acceptedBy`, `declinedBy`, `respondedOn`, `revokedOn`, `publishedOn`, `published`, `referenceCode`, `salesMarginPercentage`, `intentType`) and lowercases the status help text. #264 makes `quotes update --product` a loud, default-no `REPLACES` confirmation instead of silently swapping line items. #266 adds `quotes line-items list/add/remove` and `quotes send`, so partners no longer have to round-trip through `update` to manage line items. Still deferred: attachments, sections, access-list, take-ownership/claim, library-level `/v2/quote-attachments`, and `/v2/quote-preferences`.

**(5) Webhook v1 fine-grained sub-routes — PARTIALLY ADDRESSED.** #265 adds `webhooks show/update/enable/disable`. #267 adds `webhooks logs retry`, `webhooks topics list`, and `webhooks test --topic <topic>` (with topic validation against `/webhooks/topic-definitions`). `webhooks logs` is now a subcommand group (`logs list` + `logs retry`) with the bare `logs [id]` form preserved as the default action for backward-compat. Still deferred: `topics add/remove/replace`, per-topic configuration (filter expressions on a single topic), and per-topic-config CRUD.

---

## Companies & Contacts

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 companies list` | `--status`, `--page`, `--size`, `--ids-only`, `--coverage`, `--with-actions` | size=25 | `--coverage` adds portfolio coverage analysis (computed) |
| `pax8 companies show <id\|name>` | accepts name as alternative to UUID | | |
| `pax8 companies create` | `--name`, `--phone`, `--website`, `--city`, `--state`, `--zip`, `--country`, `-y` | country=US | |
| `pax8 companies update <id\|name>` | `--name`, `--phone`, `--website`, `-y` | | No address/billing-flag updates exposed |
| `pax8 companies more` | (interactive paging helper) | | CLI-only |
| `pax8 contacts list` | `--company <id\|name>` (required), `--page`, `--size`, `--ids-only` | size=50 | |
| `pax8 contacts show <id>` | | | |
| `pax8 contacts create` | `--first-name`, `--last-name`, `--email`, `--phone`, `--type <list>`, `-y` | type=Admin | `--type` accepts a comma-separated list (`Admin,Billing`) post-#255 |
| `pax8 contacts update <id>` | `--first-name`, `--last-name`, `--email`, `--phone`, `--type <list>`, `-y` | | `--type` accepts a comma-separated list post-#255 |
| `pax8 contacts delete <id>` | `-y` | | |

CLI output schemas (Zod) — `Company`: `id, name, address{street,city,state,zip,country}, phone, website, status, billOnBehalfOfEnabled, selfServiceAllowed, orderApprovalRequired, created, modified`. `Contact`: `id, firstName, lastName, email, phone, companyId, types[]`.

### Public API Surface

`GET/POST /companies` (filters: `page, size, sort, city, country, stateOrProvince, postalCode, selfServiceAllowed, billOnBehalfOfEnabled, orderApprovalRequired, status`); `GET/PATCH /companies/{companyId}`; `GET/POST /companies/{companyId}/contacts` (`page, size`); `GET/PUT/DELETE /companies/{companyId}/contacts/{contactId}`.

API `Company`: `id, name, address, phone, website, status, billOnBehalfOfEnabled, selfServiceAllowed, orderApprovalRequired, externalId, contacts[], updatedDate`. API `Contact`: `id, firstName, lastName, email, phone, types[], createdDate`. `ContactType` enum: `Admin, Billing, Technical`.

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `address.stateOrProvince` (query) / `state` (body) | `--state` | API is inconsistent; CLI normalizes to `state` |
| `address.postalCode` (query) / `zip` (body) | `--zip` | Same — CLI picks the shorter body field |
| `externalId` | (not exposed) | API surfaces a partner-side external ID; CLI hides it |
| `updatedDate` | `modified` | CLI rename |
| `createdDate` (Contact) | (not exposed on Contact) | Only surfaced on Company-ish resources |
| `contacts[]` (embedded on Company) | (separate `contacts list`) | CLI separates rather than embeds |
| `types[]` (array of `Admin\|Billing\|Technical`) | `--type <comma-list>` | CLI accepts multiple types as a comma-separated string [Resolved in #255] |

### Coverage

- **API-only (CLI doesn't expose):** address-based filters on `companies list` (`--city`, `--country`, `--state`, `--zip`), the `selfServiceAllowed`/`billOnBehalfOfEnabled`/`orderApprovalRequired` filters on list, `externalId` field on Company, address & billing-flag updates via `companies update`.
- **CLI-only:** `--coverage` flag (computed: see Recommendations); `--ids-only`; `--with-actions`; `companies more` (interactive paging).

### Naming Drift Flags

- `--type` accepts one value; API accepts an array. [Resolved in #255 — comma-separated list now accepted on both create and update.]
- `companies update` cannot change address or the three boolean billing flags. Confirm whether this is an intentional safety choice or an oversight.
- CLI `Company.modified` vs API `updatedDate` — pick one and align.

### Questions for Domain Owner

1. Is the CLI right to hide `externalId` from list/show, or do partners need it?
2. Is `companies update` deliberately address-immutable?

---

## Subscriptions & Renewals

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 subscriptions list` | `--company`, `--status`, `--page`, `--size`, `--ids-only`, `--with-actions` | size=25 | |
| `pax8 subscriptions show <id>` | `--history` | | |
| `pax8 subscriptions update <id>` | `--quantity`, `--billing-term`, `-y` | | |
| `pax8 subscriptions cancel <id>` | `--cancel-date <YYYY-MM-DD>`, `-y` | | `--cancel-date` for scheduled cancellation [Added in #256] |
| `pax8 subscriptions renewals` | `--within <period>`, `--company`, `--with-actions` | within=30d | **Computed — see below** |

CLI `Subscription`: `id, companyId, productId, quantity, startDate, endDate, createdDate, billingStart, status, price, billingTerm, commitment{id,term,endDate}, commitmentTermEndDate, companyName, productName`.

CLI `SubscriptionStatus` enum: `Active, Cancelled, PendingManual, PendingAutomated, PendingCancel, WaitingForDetails, Trial, Converted, PendingActivation, Activated` [Aligned with public API in #252 — `Inactive`/`Deleted` removed; `PendingActivation`/`Activated` added].

### Public API Surface

`GET /subscriptions` (filters: `page, size, sort, status, billingTerm, companyId, productId`); `GET/PUT/DELETE /subscriptions/{id}` (DELETE accepts `cancelDate`); `GET /subscriptions/{id}/history`; `GET /subscriptions/{id}/usage-summaries`.

API `Subscription`: `id, parentSubscriptionId, companyId, productId, vendorSubscriptionId, quantity, startDate, endDate, createdDate, updatedDate, billingStart, status, price, currencyCode, partnerCost, billingTerm, provisioningDetails, commitmentTerm{id,term,endDate}`.

API `SubscriptionStatus` enum: `Active, Cancelled, PendingManual, PendingAutomated, PendingCancel, WaitingForDetails, Trial, Converted, PendingActivation, Activated`.

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `commitmentTerm` (object: `{id, term, endDate}`) | `commitment` (alias) + `commitmentTermEndDate` (top-level) | CLI flattens the nested endDate to the top level |
| `commitmentTerm.endDate` | `renewalDate` (in `renewals` output) | Renamed in computed surface |
| `vendorSubscriptionId` | (not exposed) | |
| `partnerCost` | (not exposed) | CLI shows `price` but not partner cost |
| `parentSubscriptionId` | (not exposed) | |
| `currencyCode` | (not exposed) | Always treated as USD |
| `updatedDate` | (not exposed) | CLI shows `createdDate` only |
| `provisioningDetails` (write-only on API) | (not exposed on subscription) | Surfaces only on order line items |

### Coverage

- **API-only:** `vendorSubscriptionId`, `partnerCost`, `parentSubscriptionId`, `currencyCode`, `updatedDate`, `--sort` query, usage-summaries sub-resource (exposed via `pax8 usage` instead).
- **CLI-only:** `subscriptions renewals` (entire command — see below).

### Computed-Layer Surfaces

| Surface | Inputs | Logic | Output | Why it exists |
|---|---|---|---|---|
| `subscriptions renewals` | All subscriptions for the partner; `--within` window (e.g. `30d`); optional `--company` filter | For each subscription with a `commitmentTerm.endDate` in the next N days: compute `daysUntilRenewal`, `mrrAtRisk` (price × quantity, divided by 12 if annual). Skip subs with no end date and report `skippedNoDate`. Sort by urgency. | `{ items: [{subscriptionId, companyId, companyName, productName, quantity, renewalDate, billingTerm, price, mrrAtRisk, daysUntilRenewal}], totalMrrAtRisk, annualCount, monthlyCount, urgentCount, skippedNoDate }` | API has no renewals endpoint. MSPs want a single answer to "what's renewing soon and what's at stake." |

### Naming Drift Flags

- `commitmentTermEndDate` (top-level) is invented by the CLI normalizer; the API only nests it inside `commitmentTerm`.
- `renewals.renewalDate` is a rename of the same field — confirm whether "renewal date" is the term Pax8 uses internally for `commitmentTerm.endDate`.
- `--within 30d` accepts a duration shorthand (`7d`, `14d`, `30d`, `90d`); not an API convention.

### Questions for Domain Owner

1. Is "renewal date" the right name for `commitmentTerm.endDate`, or should the CLI just call it `commitmentTermEndDate` everywhere?
2. The CLI's MRR-at-risk calculation is `price × quantity ÷ 12 (if annual)` — is that the formula your team uses, and is it OK to make this part of a public contract?
3. Should `--billing-term` on update accept the full enum (`Monthly, Annual, 2-Year, 3-Year, One-Time, Trial, Activation`) or only `Monthly`/`Annual` as today?

---

## Invoices & Billing

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 invoices list` | `--month YYYY-MM`, `--company`, `--status`, `--page`, `--size`, `--ids-only`, `--with-actions` | size=25 | |
| `pax8 invoices show <id>` | | | |
| `pax8 invoices items` | `--month`, `--company`, `--invoice-id`, `--page`, `--size` | size=25 | |
| `pax8 invoices audit` | `--month`, `--company` | | **Computed — see below** |
| `pax8 invoices dispute` | `--discrepancy <id>`, `--company`, `--product`, `--month`, `--reason`, `-y` | | **Computed — see below** |

CLI `Invoice`: `id, companyId, invoiceDate, dueDate, status?, total, balance, companyName` [`status` is now optional, post-#260].
CLI `InvoiceStatus` enum: `Unpaid, Paid, Void, Carried` [Aligned with the OpenAPI `Invoice.example` in #260 — `Carry` renamed to `Carried`; `Nothing` and the `Overdue` filter alias removed].
CLI `InvoiceItem`: `id, invoiceId, productId, subscriptionId, quantity, unitPrice, subtotal, companyId, productName, companyName`.

### Public API Surface

`GET /invoices` (filters: `page, size, sort, status, invoiceDate, invoiceDateRangeStart, invoiceDateRangeEnd, dueDate, total, balance, carriedBalance, companyId`); `GET /invoices/{invoiceId}`; `GET /invoices/{invoiceId}/items` (`page, size`); `GET /invoices/draftItems` (`page, size, monthOffset, companyId` — CLI does not surface this).

API `Invoice` fields: `id, invoiceDate, dueDate, balance, carriedBalance, total, currencyCode, partnerName, companyId, externalId`. The query parameter `status` and the `Invoice.example` block both reference a status field (`Unpaid, Paid, Void, Carried`); however, `Invoice.properties` in the OpenAPI does not declare it. Believed to be a docs gap on Pax8's side. **Pending follow-up: a docs ticket against the public OpenAPI to add `status` formally.**

API `InvoiceItem` fields (32 total — selected): `id, productId, productName, subscriptionId, quantity, price, subTotal, total, amountDue, cost, costTotal, billingFee, billingFeeRate, salesTax, currencyCode, chargeType, rateType, type, term, unitOfMeasure, sku, vendorName, offeredBy, billedByPax8, startPeriod, endPeriod, description, details, purchaseOrderNumber, externalId, companyId, companyName`.

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `status` (in query param + spec example, missing from properties) | `status?` (typed enum, optional) | CLI now mirrors the spec example; pending docs fix on Pax8 side [Resolved in #260] |
| `subTotal` (capital T) | `subtotal` | Casing change |
| `price` | `unitPrice` | Rename |
| `monthOffset` (draft-items query) | `--month YYYY-MM` | CLI normalizes to a calendar month |
| `startPeriod`, `endPeriod`, `term`, `chargeType`, `rateType`, `type`, `billingFee`, `billingFeeRate`, `salesTax`, `cost`, `costTotal`, `amountDue`, `unitOfMeasure`, `vendorName`, `offeredBy`, `billedByPax8`, `purchaseOrderNumber`, `sku`, `externalId`, `description`, `details` | (not exposed) | InvoiceItem cost/period/category breakdown collapsed |
| `carriedBalance`, `currencyCode`, `partnerName` (Invoice) | (not exposed) | |

### Coverage

- **API-only:** `/invoices/draftItems` (not surfaced anywhere), all of `currencyCode`, `partnerName`, `carriedBalance`, the full InvoiceItem cost/tax/fee/period breakdown, `externalId`.
- **CLI-only:** `invoices audit`; `invoices dispute`. (`Invoice.status` is no longer CLI-only — see #260.)

### Computed-Layer Surfaces

| Surface | Inputs | Logic | Output | Why it exists |
|---|---|---|---|---|
| `invoices audit` | All invoice items in window + all active subscriptions for the partner | Match each invoice item to an active subscription either by `subscriptionId` or by `(companyId, productId)` (aggregating quantity across multiple subs in a group). Compare invoiced quantity vs. active quantity. Emit a discrepancy per mismatch with type `overcharge`, `undercharge`, `unexpected` (invoiced but no active sub), or `missing` (active sub never invoiced). | `{ discrepancies: [{companyId, companyName, productName, invoicedQuantity, activeQuantity, delta, dollarImpact, type}], totalOvercharge, totalUndercharge, netImpact, itemsAudited }` | The API has no reconciliation endpoint. Composes 13+ API calls into one answer. |
| `invoices dispute` | A discrepancy ID from `audit --json` (or company/product/month filters) plus a free-form `--reason` | Looks up the discrepancy, formats a support-template message, optionally writes a draft. **Does not call any Pax8 dispute API** (none is documented publicly). | A draft text + next-action hints. | Closed-loop UX for "I see an overcharge — log it." Today this is template-only. |

### Naming Drift Flags

- `Invoice.status` is now aligned with the spec example (`Unpaid`, `Paid`, `Void`, `Carried`) and optional [Resolved in #260]. A docs ticket against the public OpenAPI to add `status` to `Invoice.properties` is the remaining follow-up.
- `subtotal` vs `subTotal`, `unitPrice` vs `price` — pick one casing/term per concept.
- The CLI hides everything between gross subtotal and net amount due (fees, tax, cost). Partners doing margin analysis cannot get `cost`/`partnerCost` from the CLI.

### Questions for Domain Owner

1. Is `invoices audit`'s reconciliation logic — match by `subscriptionId` first, then `(companyId, productId)` aggregating across active subs — what your billing team would do?
2. Should `invoices dispute` block until a real dispute API exists, or is "draft a support-template message" the right product?
3. Should the CLI surface `costTotal` / `partnerCost` for margin tracking?

---

## Orders & Quotes

### CLI Surface — Orders

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 orders list` | `--company`, `--status`, `--page`, `--size`, `--ids-only` | size=25 | Status enum is CLI-defined |
| `pax8 orders show <id>` | | | |
| `pax8 orders create` | `--company`, `--product`, `--quantity`, `--billing-term`, `--commitment-term`, `--commitment-term-id`, `--line-item <spec>` (repeatable), `--dry-run`, `-y`, `--idempotency-key` | qty=1, billing=Monthly | Multi-line via repeated `--line-item product=…,quantity=…[,billing-term=…][,commitment-term=…][,commitment-term-id=…]`; `--dry-run` maps to API `isMock=true` [Added in #259] |

CLI `Order`: `id, companyId, companyName, orderedBy, orderedByEmail, status, createdDate, lineItems[{id, offerId, productId, productName, billingTerm, lineItemNumber, quantity, provisioningDetails}]`.

### Public API Surface — Orders

`GET /orders` (`page, size, companyId`); `POST /orders` (`isMock` query); `GET /orders/{orderId}`. API `Order`: `id, companyId, createdDate, isScheduled, lineItems[], orderedBy, orderedByUserEmail, orderedByUserId`. No documented status field on Order.

### CLI Surface — Quotes

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 quotes list` | `--company`, `--status`, `--page`, `--size`, `--ids-only` | size=50 | Status help text now lowercase to match API (`draft, sent, ...`) [#261] |
| `pax8 quotes show <id>` | | | Now exposes accept/decline workflow fields when present [#261] |
| `pax8 quotes create` | `--company`, `--product`, `--quantity`, `--billing-term`, `--expiration-date`, `-y` | qty=1, billing=Monthly | Single-line shorthand; use `quotes line-items add` to add more |
| `pax8 quotes update <id>` | `--product`, `--quantity`, `--billing-term`, `--expiration-date`, `-y` | | Now displays a default-no `REPLACES` confirmation diff before clobbering line items [#264] |
| `pax8 quotes delete <id>` | `-y` | | |
| `pax8 quotes line-items list <quote-id>` | `--ids-only` | | Lists line items on a quote [Added in #266] |
| `pax8 quotes line-items add <quote-id>` | `--product` (required), `--quantity`, `--billing-term`, `-y` | qty=1, billing=Monthly | Adds a single line item via `POST /v2/quotes/{id}/line-items` [Added in #266] |
| `pax8 quotes line-items remove <quote-id> <line-item-id>` | `-y` | | Removes a single line item [Added in #266] |
| `pax8 quotes send <quote-id>` | `-y` | | Sets quote status to `sent` (generates customer-facing link) via `PUT /v2/quotes/{id}` [Added in #266] |

CLI `Quote`: `id, companyId, createdDate, expirationDate, status, lineItems[{id, productId, quantity, billingTerm, unitPrice, subtotal}], acceptedBy?, declinedBy?, respondedOn?, revokedOn?, publishedOn?, published?, referenceCode?, salesMarginPercentage?, intentType?` [accept/decline workflow fields added in #261; line-item `id` surfaced for use with `line-items remove`].

### Public API Surface — Quotes (v2)

The v2 quotes API spans 18 endpoints across `/v2/quotes`, `/v2/quotes/{id}/{sections,line-items,attachments,access-list,take-ownership}`, plus library-level `/v2/quote-attachments` and `/v2/quote-preferences`. Methods include the full CRUD set plus `bulk-delete` for line items and `take-ownership` as an explicit action.

API `QuoteResponse` fields: `id, status, intentType (PARTNER_TO_CLIENT \| PAX8_TO_PARTNER \| PAX8_TO_PARTNER_CLIENT), salesMarginPercentage, referenceCode, createdBy, createdByEmail, createdOn, expiresOn, ownedBy, partner, client, lineItems, attachments[], acceptedBy, declinedBy, respondedOn, revokedOn, publishedOn, published, introMessage, termsAndDisclaimers, totals, quoteRequestId`.

API `Quote.status` enum: `draft, assigned, sent, closed, declined, accepted, changes_requested, expired, pending` (lowercase).

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `orderedByUserEmail` | `orderedByEmail` | Rename |
| `orderedByUserId` | (not exposed) | |
| `isScheduled` | (not exposed) | |
| `isMock` (POST query) | `--dry-run` | [Resolved in #259] |
| `expiresOn` | `expirationDate` | Rename |
| `createdOn` | `createdDate` | Rename |
| `intentType` | `intentType?` (read-only) | Surfaced in `Quote` schema [Added in #261]; not yet a `--intent-type` write flag |
| `acceptedBy`, `declinedBy`, `respondedOn`, `revokedOn`, `publishedOn`, `published`, `referenceCode`, `salesMarginPercentage` | same names (read-only, optional) | [Resolved in #261] |
| `partner`, `client`, `ownedBy`, `introMessage`, `termsAndDisclaimers`, `totals`, `quoteRequestId`, `attachments` | (not exposed) | Still flattened away |
| Quote status (lowercase: `draft, sent, accepted, ...`) | lowercase in `--status` filter help [#261] | [Resolved in #261] |

### Coverage

- **API-only (Orders):** `--sort`, `isScheduled`, `parentSubscriptionId` linkage. (`isMock` and multi-line creation are now exposed — see #259.)
- **API-only (Quotes):** v2 sections, attachments (library `/v2/quote-attachments` + per-quote `/v2/quotes/{id}/attachments` + `/v2/quote-preferences`), access-list / sharing, take-ownership / claim, line-item `bulk-delete`, totals, terms/disclaimers, intro messages, intent-type as a writable input. (Accept/decline visibility, line-item add/remove/list, send, and a destructive-update warning are now in.)
- **CLI-only:** `idempotency-key` on `orders create`; status filter values on orders (`Completed, Processing, Failed, PendingManual` — none documented); single-line shorthand on quotes (`quotes create --product ...` is sugar for `create` then `line-items add`).

### Naming Drift Flags

- `Order.status` filter-help vocabulary still does not match any documented enum. Confirm what statuses partners actually see.
- `Quote.status` filter help is now lowercase to match the API [Resolved in #261].
- `expirationDate` (CLI) vs `expiresOn` (API): keep one.
- The CLI quotes surface still hides about half of the v2 model (sections, attachments, access-list, take-ownership). The newly added line-items subcommands and `send` cover the most-requested workflow gaps.
- `quotes update --product` is no longer silently destructive — it shows a default-no `REPLACES` confirmation [Resolved in #264]. The non-destructive path is `quotes line-items add/remove` [#266].

### Questions for Domain Owner

1. Should the CLI expose the remaining v2 quote concepts (sections, attachments, access list, take-ownership/claim) or stop at the line-item-and-send surface as today?
2. What is the canonical Order status enum partners should see? The CLI invents `Completed, Processing, Failed, PendingManual`.
3. Should `orders create` also expose `--is-scheduled`?
4. Should `intentType` become a writable `--intent-type` flag on `quotes create`, or remain a read-only field?

---

## Products & Catalog

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 products list` | `--vendor`, `--page`, `--size`, `--ids-only` | size=25 | |
| `pax8 products search <query>` | `--vendor` | | |
| `pax8 products show <id\|name>` | `--pricing`, `--provisioning`, `--dependencies` | | |

CLI `Product`: `id, name, vendorName, vendor, sku, shortDescription, description, unitOfMeasurement` [`categoryName` removed in #254 — it was not in the API spec].
CLI `ProductPricingPlan`: `productId, productName, billingTerm, commitmentTerm, commitmentTermInMonths, type, unitOfMeasurement, rates[{partnerBuyRate, suggestedRetailPrice, startQuantityRange, chargeType}]`.

### Public API Surface

`GET /products` (`page, size, sort, search, vendorName`); `GET /products/{productId}`; `GET /products/{productId}/pricing` (`companyId`); `GET /products/{productId}/provision-details`; `GET /products/{productId}/dependencies`.

API `Product`: `id, name, vendorName, vendorSku, altVendorSku, sku, shortDescription, requiresCommitment`. API `ProductDetail` (single-product GET) adds `description`. API `Pricing`: `productId, productName, billingTerm, commitmentTerm, commitmentTermInMonths, type, unitOfMeasurement, rates[]`.

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `vendorName` | `vendorName` (and also `vendor`) | CLI carries both — drop one |
| `vendorSku`, `altVendorSku` | (not exposed) | CLI exposes only the Pax8 `sku` |
| `requiresCommitment` | (not exposed) | API tells you a product requires commitment; CLI doesn't surface it |
| `unitOfMeasurement` | `unitOfMeasurement` | Matches API |
| `unitOfMeasure` (on InvoiceItem only — see Invoices) | `unitOfMeasurement` | Inconsistent in API; CLI normalizes to long form |
| `companyId` (pricing query) | (not exposed) | Pricing is fetched without a company filter |
| `categoryName` | (removed) | [Resolved in #254 — dropped from `ProductSchema`] |

### Coverage

- **API-only:** `--sort` query, `vendorSku` / `altVendorSku` lookup, `requiresCommitment` flag on Product, company-scoped pricing lookup (`/products/{id}/pricing?companyId=X`).
- **CLI-only:** `--pricing`/`--provisioning`/`--dependencies` collapsed into one show command instead of three resources. (`categoryName` removed in #254.)

### Naming Drift Flags

- `vendor` vs `vendorName` on the CLI Product schema — duplicate fields with no clear winner.
- `unitOfMeasurement` (Product, Pricing) vs `unitOfMeasure` (InvoiceItem) — the API ships both spellings; the CLI silently normalizes to `unitOfMeasurement` everywhere. **Intentional deviation, worth confirming.**
- `categoryName` removed [Resolved in #254].

### Questions for Domain Owner

1. Should `products show` accept `--company` so partners get company-scoped pricing (the API supports this)?
2. Should `requiresCommitment` be surfaced — it changes the order flow (commitment-term required vs not).
3. `vendorSku` and `altVendorSku` are how vendors identify their own SKU; should partners be able to look products up by them?

---

## Recommendations

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 recommendations list` | `--company`, `--priority`, `--type`, `--product`, `--include-all`, `--with-actions`, `--limit` | limit=10 | **Computed** |
| `pax8 recommendations act` | `--company`, `--product`, `--priority`, `-y` | | **Computed — closed-loop** |

CLI `Recommendation`: `companyId, companyName, type ('cross_sell' \| 'seat_gap'), priority ('high' \| 'medium' \| 'low'), title, reason, suggestedProducts[], orderCommand, productAvailable, currentMrr, estimatedMrrUplift, targetSeats, estimateType ('upper_bound')`.

### Public API Surface

There is no `/recommendations` endpoint in the public API. This entire domain is computed.

### Computed-Layer Surfaces

| Surface | Inputs | Logic | Output | Why it exists |
|---|---|---|---|---|
| `recommendations list` | All companies, all active subscriptions, all products + pricing | Categorize each subscription's product into one or more of seven CLI-defined categories (`productivity, email, security, endpoint_protection, identity, backup, cloud_infrastructure`). For each company: (1) apply seven cross-sell rules of the form "if has X but missing Y, recommend Z" with hardcoded reasons and priority; (2) detect seat gaps within a category where the secondary product has <50% coverage of the primary and >=10 missing seats. Filter out restricted SKUs (non-profit, charity, GCC, education, government, AOS). Resolve a concrete catalog product ID for each recommendation; if none, demote priority and use a generic title. Compute `estimatedMrrUplift = unitPrice × seatCount` (upper bound). Flag companies with zero subscriptions. Dedupe and sort by priority then uplift. | `{ recommendations: [...], totalCompanies, companiesWithGaps, estimatedTotalMrrUplift, unmatchedProducts[] }` | API has no recommendations endpoint. MSPs want "what should I sell next, to whom, and how much is it worth." |
| `recommendations act` | Filter set + `recommendations list` output | Picks recommendations via interactive multi-select (or `-y` to take all matching). For each, runs the embedded `orderCommand`. | Order results, one per picked recommendation. | Closed-loop ordering — converts an analysis into a batch of `orders create` calls. |

The seven categories, the seven cross-sell rules, the seat-gap thresholds (10 seats, 50% coverage, primary ≥10 seats), the restricted-SKU regex, and the suggested-product names (e.g. `"AvePoint Cloud Backup for Microsoft 365"`, `"Microsoft Defender for Office 365 (Plan 1) [New Commerce Experience]"`) are all hardcoded in the CLI.

### Naming Drift Flags

- The category taxonomy (`productivity, email, security, endpoint_protection, identity, backup, cloud_infrastructure`) is not from the API. If Pax8 has a canonical category model, confirm it.
- The cross-sell reasons are written for end-user MSPs; some make security claims ("the #1 attack vector") that should be reviewed by Pax8 messaging owners before being treated as a public contract.
- The hardcoded suggested-product names tie this engine to specific SKUs; vendor renames break it silently.
- `companies list --coverage` exposes the same coverage analysis under the Companies surface — surface duplication.

### Questions for Domain Owner

1. Are these the categories Pax8 wants to standardize on?
2. Are these the cross-sell rules and reason texts that should be marketed externally?
3. Should `productAvailable=false` recommendations be hidden by default rather than `--include-all`?
4. Is "upper bound" MRR uplift (full primary-seat count × monthly price) the right framing, or should this be a forecast / range?
5. Is `recommendations act` a Pax8 product or a CLI convenience? It is a write-amplifying surface (one click, many orders).

---

## Webhooks & Events

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 webhooks list` | `--ids-only`, `--with-actions` | | |
| `pax8 webhooks show <id>` | | | View a single webhook subscription [Added in #265] |
| `pax8 webhooks create` | `--url`, `--topics <comma-list>`, `-y` (with `--events` as a deprecated alias) | | |
| `pax8 webhooks update <id>` | `--display-name`, `--authorization`, `--contact-email`, `--error-threshold`, `-y` | | Configures the four mutable fields via `PUT /webhooks/{id}/configuration` [Added in #265]; redacts `--authorization` in echo |
| `pax8 webhooks enable <id>` | `-y` | | Sets `active=true` via `PUT /webhooks/{id}/status` [Added in #265] |
| `pax8 webhooks disable <id>` | `-y` | | Sets `active=false` via `PUT /webhooks/{id}/status` [Added in #265] |
| `pax8 webhooks delete <id>` | `-y` | | |
| `pax8 webhooks test <id>` | `--topic <topic>` | | `--topic` validates against `/webhooks/topic-definitions` then calls topic-specific test [Added in #267] |
| `pax8 webhooks logs [id]` | `--since`, `--ids-only`, `--with-actions` | | `[id]` optional — without it, shows logs across all webhooks. Now a subcommand group; bare form preserved for backward-compat. |
| `pax8 webhooks logs list [id]` | `--since`, `--ids-only`, `--with-actions` | | Explicit list form (same as bare `logs`) [#267] |
| `pax8 webhooks logs retry <log-id>` | `--webhook <id>`, `-y` | | Re-delivers a failed event via `POST /webhooks/{webhookId}/logs/{logId}/retry`; resolves `--webhook` automatically by walking subscriptions if omitted [Added in #267] |
| `pax8 webhooks topics list` | `--ids-only`, `--with-actions` | | Lists topic definitions from `GET /webhooks/topic-definitions` [Added in #267] |

CLI `Webhook`: `id, url, topics[], status ('Active' \| 'Disabled'), createdDate, secret` [`secret` is the real HMAC-signing secret returned on `POST /webhooks` (visible only on create-response, per JSDoc clarified in #254)].
CLI `WebhookLog`: `id, webhookId, topic, responseCode, responseBody, sentAt`.

### Public API Surface (Webhooks v1)

12 endpoints. CRUD on `/webhooks` and `/webhooks/{id}`. Three sub-resources for fine-grained updates the CLI doesn't expose: `/configuration` (authorization, contactEmail, errorThreshold), `/status` (enable/disable), `/topics` (add, replace, remove, per-topic config, per-topic `test`). A topic-definitions catalog at `/webhooks/topic-definitions`. Logs at `/webhooks/{id}/logs` with a per-log `retry` action.

API `Webhook` fields: `id, accountId, displayName, url, authorization, active, contactEmail, errorThreshold, integrationId, webhookTopics[], lastDeliveryStatus, createdAt, updatedAt`.

### Vocabulary Mapping

| API Term | CLI Term | Notes |
|---|---|---|
| `active` (boolean) | `status: 'Active'\|'Disabled'` | Boolean ↔ enum mapping |
| `webhookTopics[]` (objects with filters/config) | `topics[]` (strings) | CLI flattens to topic names |
| `--events` flag | `topics` (API) | Renamed to `--topics`; `--events` kept as a deprecated alias [#273] |
| `createdAt` / `updatedAt` | `createdDate` | Rename + `updatedAt` dropped |
| `displayName`, `authorization`, `contactEmail`, `errorThreshold`, `integrationId`, `accountId`, `lastDeliveryStatus` | (not exposed) | |

### Coverage

- **API-only:** per-topic filter configuration / topic CRUD (`/webhooks/{id}/topics` add/replace/remove plus per-topic config), `integrationId`, `lastDeliveryStatus`. (`update`, `enable`, `disable`, `logs retry`, topic-definitions discovery, per-topic test, and the `displayName/authorization/contactEmail/errorThreshold` config fields are now exposed — see #265 and #267.)
- **CLI-only:** cross-webhook log view (`logs` with no ID), `--since` duration filter on logs, automatic `--webhook` resolution on `logs retry`. Webhook `secret` is documented (HMAC-signing secret, visible only on create response) and is the real value from `POST /webhooks` [Documented in #254].

### Naming Drift Flags

- `--events` flag vs `topics` in the API and in the CLI's own output schema. Resolved in #273: canonical flag is now `--topics`; `--events` retained as a deprecated alias until v1.0.
- The CLI calls webhooks "subscriptions" in help text ("Create a webhook subscription") — collides with the Subscriptions domain.
- API `active: true/false` vs CLI `status: 'Active'/'Disabled'` — same bit, different shape; the new `webhooks enable`/`disable` commands abstract the boolean away.
- `secret` provenance is now documented in the schema's JSDoc (HMAC-signing secret, returned on POST response only) [Resolved in #254].

### Questions for Domain Owner

1. ~~Should `--events` be renamed `--topics` for consistency with the API and the CLI's own `Webhook.topics[]` field?~~ Resolved in #273: yes, with `--events` kept as a deprecated alias.
2. Should `webhooks` be called something else to avoid clashing with the Subscriptions domain?
3. Should the CLI add `webhooks topics add/remove/replace` for fine-grained per-topic config, or is the current "set whole list at create time" enough?
4. Should `webhooks update` also expose `--integration-id`?

---

## Reporting & Analytics

### CLI Surface

| Command | Args / Flags | Default | Notes |
|---|---|---|---|
| `pax8 report mrr` | (none) | | **Computed** |
| `pax8 report growth` | `--months <number>` | months=6 | **Computed** |
| `pax8 status` | (none) | | **Computed — portfolio overview** |
| `pax8 cost sim` | `--company`, `--product`, `--quantity`, `--from`, `--from-quantity`, `--billing-term` | qty=1, billing=Annual | **Computed — what-if simulator** |
| `pax8 doctor` | (none) | | Diagnostics |

### Public API Surface

There are no `/report`, `/mrr`, `/growth`, or `/cost` endpoints in the public API. This entire domain is computed.

### Computed-Layer Surfaces

| Surface | Inputs | Logic | Output | Why it exists |
|---|---|---|---|---|
| `report mrr` | All active subscriptions | For each: `monthly = price × quantity`; `annual term = price × quantity ÷ 12`. Group by `companyId`, `productName`, `vendorName`. | `{ totalMrr, byCompany[], byProduct[], byVendor[] }` | API has no MRR endpoint. |
| `report growth` | All invoices for the partner | Group invoice totals by `YYYY-MM`, take last N months, compute MoM `delta` and `growthPercent`, plus `averageGrowth`. **Note: this is invoiced revenue, not MRR.** | `{ months[], averageGrowth }` | API has no growth/trend endpoint. |
| `status` | All companies, all subscriptions, all products, all orders, plus the `recommendations list` output and the `subscriptions renewals` output | Computes top customers by MRR, total seats, urgent renewals (≤14d), top recommendations. | Portfolio-level dashboard JSON or formatted table. | Single-call landing page for "how is my business doing." |
| `cost sim` | Target company + proposed product, optional `--from` (current product), pricing plans for the proposed product | Resolve current subscription via company × product (or via `--from`); look up proposed pricing plan by billing term; pick volume tier (largest `startQuantityRange` ≤ proposed quantity); compute `monthly = subscriptionMrr(unitPrice, quantity, billingTerm)`, `annual = monthly × 12`, deltas, and per-seat delta. Emit notes for tier selection, default-Annual fallback, billing-term swap. | `{ current: {...} \| null, proposed: {unitPrice, quantity, monthly, annual, productName, billingTerm}, delta: {monthly, annual, perSeat}, notes[] }` | What-if pricing without placing the order. |

### Naming Drift Flags

- `report growth` is computed from invoiced revenue, but the field is named `mrr` and the percent is `growthPercent`. Partners reading "MRR growth" may assume it's recurring revenue trended forward, not invoice totals trended backward. Worth a label change.
- `status` mixes computed surfaces (renewals, recommendations) into one response. Any contract change in those flows through `status`.
- `cost sim` does not call any documented Pax8 simulation endpoint. The volume-tier rule (largest `startQuantityRange` ≤ qty) is the CLI's interpretation.

### Questions for Domain Owner

1. Is "MRR" the right label for monthly invoiced totals, or should `report growth` say "billed revenue"?
2. Is `subscriptionMrr` (annual ÷ 12, monthly × 1, everything else × 1) the canonical Pax8 formula? Specifically: 2-Year, 3-Year, One-Time, Trial, Activation are all treated as monthly today.
3. Should `status` be a public contract or an internal landing page? It composes outputs from three other computed surfaces.
4. Should `cost sim` consume volume tiers from Pax8 (it does, via `/products/{id}/pricing`) but also surface partner-specific pricing (the API supports `?companyId=X` here)?

---

## Workflows

The Pax8 internal **Preliminary Workflows** doc enumerates canonical end-to-end partner flows that span multiple domains. The post-merge CLI now covers the *Automated Quoting and Sales Cycle* flow start-to-finish; each step below maps to one CLI command.

### Automated Quoting and Sales Cycle

| Step | API call | CLI command (post-merge) |
|---|---|---|
| 1. CRM trigger creates a quote draft | `POST /v2/quotes` | `pax8 quotes create --company X --product Y --quantity N` |
| 2. Add additional line items to the draft | `POST /v2/quotes/{id}/line-items` | `pax8 quotes line-items add <quote-id> --product Y --quantity N` (#266) |
| 3. Set status to sent (generates customer-facing link) | `PUT /v2/quotes/{id}` with `status: "sent"` | `pax8 quotes send <quote-id>` (#266) |
| 4. Subscribe to QUOTE.Accepted webhook events | `POST /webhooks` with `topics: ["QUOTE.Accepted"]` | `pax8 webhooks create --url X --topics QUOTE.Accepted`; discover topics via `pax8 webhooks topics list` (#267) |
| 5. On QUOTE.Accepted, trigger order placement | `POST /orders` | `pax8 orders create --company X --product Y --quantity N` |

**Naming-coordination note:** the workflow assumes the `pax8-submit-order` MCP tool (Linear AI-865) and the CLI's `orders create` will eventually converge on the same vocabulary. Flag-naming coordination between the CLI team and the MCP team is worth doing once, before partners start building automations against both.

---

## Cross-cutting Concerns

### Public-blessed tier list

Independent of this CLI, the following endpoints are confirmed as public-API contract per Pax8 internal evidence. The four evidence points are:

- TypeSpec contracts in `pax8-api-specs` (especially `specs/integrations/webhooks/`).
- ADR-0078 (multi-version API with `X-API-Version` routing — v2 and v2.1 served simultaneously).
- Partner-facing documentation that treats webhook configuration as a core surface.
- PAE-1898 (idempotency for `POST /webhooks` per ADR-0080) and PAE-1909 (OpenAPI codegen migration).

Note: "the CLI consumes endpoint X" is **not** evidence here — this doc reviews the CLI, so that would be circular.

| Tier | Endpoints | Status |
|---|---|---|
| **Public-blessed (contract)** | `/orders`, `/subscriptions`, `/companies`, `/contacts`, `/products`, `/invoices`, `/usage-summaries`, `/webhooks` (config/topics/logs/retry), `/v2/quotes` (+ `/line-items`, `/take-ownership`) | On `api.pax8.com`; TypeSpec contracts exist; partner docs treat as core; ADRs cover versioning and idempotency. |
| **Portal-only (not in public API)** | Storefront publishing, notification template sends, vendor resource-group mapping | Explicitly flagged as gaps in the internal API-vs-portal review; the CLI does not and should not expose these. |
| **Computed (CLI invents)** | `subscriptions renewals`, `invoices audit`, `invoices dispute`, `recommendations list`/`act`, `report mrr`/`growth`, `cost sim`, `companies list --coverage`, `status` | No API equivalent; needs domain-owner blessing before partners depend on these as a public contract. |

### Conventions

**Pagination.** API returns `{ page: {size, totalElements, totalPages, number}, content: [] }` with size default 10, max 200. CLI mirrors the shape but defaults `--size` to 25 (50 on contacts/quotes/usage). API `--sort` is not surfaced anywhere in the CLI.

**Error envelope.** API: `{ type, message, instance, status, details[] }`, no code taxonomy. CLI `--json` mode adds 12 stable machine-readable codes (`ERROR_AUTH_EXPIRED`, `ERROR_AUTH_MISSING`, `ERROR_COMPANY_NOT_FOUND`, `ERROR_PRODUCT_NOT_FOUND`, `ERROR_SUBSCRIPTION_NOT_FOUND`, `ERROR_RATE_LIMITED`, `ERROR_API_TIMEOUT`, `ERROR_API_VALIDATION`, `ERROR_INVALID_INPUT`, `ERROR_NOT_AUTHORIZED`, `ERROR_NOT_FOUND`, `ERROR_INTERNAL`). **Intentional deviation, worth confirming.**

**ID formats.** API uses `format: uuid` for all primary IDs. CLI mirrors this with `z.string().uuid()`. API `externalId` (Company, Invoice, InvoiceItem) is hidden by the CLI. The CLI's `<id|name>` polymorphic resolver is a CLI ergonomic, not an API feature.

**Date and time formats.** API: ISO 8601 `date-time` for create/update, `yyyy-MM-dd` for invoice dates, `date` (no time) for `billingStart`. CLI accepts `YYYY-MM` for `--month` and duration shorthands (`7d`, `30d`, `90d`) for `--within`/`--since`. Neither shorthand is an API convention.

**Authentication.** API: OAuth2 client credentials at `POST /token`. CLI: ENV (`PAX8_CLIENT_ID`/`PAX8_CLIENT_SECRET`) or `~/.pax8/credentials.json`; `PAX8_API_BASE` overrides both API and token endpoints.

**Write-safety conventions (CLI-only).** Writes prompt for confirmation unless `-y`/`PAX8_YES=1`. `orders create` accepts `--idempotency-key` (24h TTL); the Pax8 API does **not** document an idempotency-key header — this is client-side. SIGINT exits 130 and logs the in-flight key. **Intentional deviation, worth confirming whether Pax8 wants to formalize idempotency server-side.**

---

## Appendix — Methodology

- **CLI source of truth:** `packages/cli/src/commands/` and Zod schemas in `packages/core/src/api/types.ts` at commit `61e7c35` on `main`.
- **API source of truth:** the OpenAPI specs at devx.pax8.com, fetched 2026-05-07 from `/openapi/{authentication,partner-endpoints,quoting-endpoints,vendor-provisioning-endpoints,vendor-usage-endpoints,webhooks-api}.json`.
- **Workflows source:** the internal Pax8 "Preliminary Workflows" doc (used as the source for the Workflows section's canonical end-to-end partner flows; the example documented here is the Automated Quoting and Sales Cycle).
- **Hidden / non-domain CLI commands omitted from the domain sections:** `auth`, `config`, `init`, `version`, `completions`, `telemetry`, `report-bug`, `doctor` (touched under Reporting), and the hidden easter eggs `coffee` and `moo`.
- **Out of scope:** `vendor-provisioning-endpoints.json` (provisioner-facing) and `vendor-usage-endpoints.json` (`/lines`, `/aggregate-lines` — vendor-side usage submission). The CLI consumes partner-side usage via `pax8 usage list`/`show` against `/subscriptions/{id}/usage-summaries` and `/usage-summaries/{id}/usage-lines`.
- **Limitations:** This review reflects only public docs at devx.pax8.com. Internal Pax8 conventions not in public docs are the human-judgment work each domain owner contributes. The six OpenAPI files do not share component schemas, so cross-domain consistency (e.g. Webhook schemas in `partner-endpoints` vs `webhooks-api`) was not exhaustively reconciled.

### Recent changes (since the prior baseline)

11 PRs landed on 2026-05-07 closing or partially-closing issues #239–#246. The squash commits are #252–#269. This refresh re-states resolved concerns as `[Resolved in #NUM]` annotations rather than deleting them — so reviewers can still trace the history of each drift item. PR set, in merge order: #252, #254, #255, #256, #259, #260, #261, #264, #265, #266, #267.
