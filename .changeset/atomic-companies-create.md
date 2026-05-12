---
"@pax8/cli": minor
"@pax8/core": minor
---

`pax8 companies create` (and its `pax8 clients create` alias) now creates Active companies by default via the atomic contacts-array pattern (PAM-997 / PAM-1171 / ARC-774). The same `POST /companies` accepts an optional `contacts: [...]` array; including a properly-typed primary contact flips the new company from Inactive to Active at creation.

New required flags on the default (atomic) path: `--first-name`, `--last-name`, `--email`, `--phone`. The supplied contact is implicitly set as `primary: true` for all three ContactType values (Admin, Billing, Technical), matching the Pax8 API Reference's activation guidance: "one contact with all three types and marked as primary for each type is sufficient." `--phone` is shared between the company and the contact — partners who need different phones can use `--company-only` then `pax8 contacts create`.

Opt-out via `--company-only` produces an Inactive company. The command prints a verbatim warning to stderr explaining the consequences (won't appear in portal, won't support orders/subscriptions/quotes, blocks re-creation with "already exists" until primary contacts are added via `pax8 contacts create`).

`@pax8/core` schema: new `CreateCompanyContactInputSchema` for the inline contact payload; `CreateCompanyInputSchema` gains an optional `contacts` field. The inline shape mirrors `CreateContactInputSchema` but omits `companyId` (the company doesn't exist yet).

Closes #330. Addresses Franco Aurieme's domain-review finding that the v0.1.0 CLI was creating Inactive companies that partners couldn't use until they discovered the contact requirement.
