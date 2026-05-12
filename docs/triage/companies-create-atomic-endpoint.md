# fix(companies): `companies create` calls the legacy two-step path, leaving companies Inactive

**Priority:** P0 — publish-blocking
**Class:** CLI built against a stale API picture (same class as #307 quotes wire-path)
**Reporter:** Franco Aurieme (PM, Account Management), via domain review of the Companies & Contacts section
**Confirmed by:** Vinton Lee (PAM backend), Mari Astapova (PAM-997)
**Activation behavior verified by:** Rovo against Pax8 API Reference + PAM-997 + ARC-774

---

## TL;DR

`pax8 companies create` posts to `POST /v1/companies` with company fields only (`name`, `phone`, `website`, `address`) and no `contacts` payload. This path leaves the company in `Inactive` state because Pax8 requires a primary contact for each of three types (`Admin`, `Billing`, `Technical`) before a company activates. The atomic create-with-contact behavior — passing a `contacts: [...]` array in the same `POST /companies` body — was added under PAM-997 specifically so the partner doesn't have to stage two-plus calls and risk leaving a ghost client.

**There is no separate atomic endpoint.** The same `POST /companies` accepts an optional `contacts` array, and including a properly-typed contact flips the new company from Inactive to Active at creation. No routing change; the request body grows.

Every partner and AI agent driving `pax8 companies create` today creates an Inactive ghost client, then has to remediate. The CLI reports success while the company is broken — the failure is silent at the surface and only manifests when downstream operations against the Inactive company fail.

This is publish-blocking for the same reason the quotes wire-path issue was: the CLI's flag list is the contract that AI agents read, and right now it tells them a lie.

---

## Activation requirements (verified via Rovo / Pax8 API Reference)

The company activates only when it has at least one contact with `primary: true` on **each** of the three contact types: `Admin`, `Billing`, `Technical`.

**Sources:**

- **Pax8 API Reference:** *"A Company is required to have a primary Contact for each Contact Type ('Admin', 'Billing', 'Technical'). One contact with all three types and marked as primary for each type is sufficient."* This is the activation rule the CLI's implicit-three-types behavior is derived from.
- **PAM-997 — Mari Astapova's confirmation comment:** *"We implemented changes to the public API for company creation to support passing a contact in the payload. This enables a company to be created in an Active state immediately."* Confirms the contacts-array pattern as the official atomic mechanism.
- **ARC-774 — architecture review:** confirms activation requires `primary: true` on all three types. The contact's `types: [...]` array must carry `{type: "Admin", primary: true}`, `{type: "Billing", primary: true}`, `{type: "Technical", primary: true}`. Anything less leaves the company Inactive.

**Edge cases that do NOT activate the company:**

- Contact with no `types` array
- Contact with `types: [...]` but `primary: false` on every type
- Contact with `primary: true` on fewer than all three types

The CLI assigns the supplied contact as `primary: true` on all three types automatically. The alternative (requiring `--type` from the partner) trades one common-case verbosity for an edge case the CLI handles less well (separate-contacts-per-type) than the dedicated `pax8 contacts add` command.

---

## Evidence — current state of the CLI

| Layer | File | What's there today |
|---|---|---|
| API client | `packages/core/src/api/companies.ts:29-32` | `create()` does `client.post("/companies", data)` with `CreateCompanyInput` (company-only fields). No `contacts` payload. |
| CLI command flags | `packages/cli/src/commands/companies/create.ts:14-22` | `--name` (required), `--phone`, `--website`, `--city`, `--state`, `--zip`, `--country`. No `--first-name`, `--last-name`, `--email`. |
| CLI call site | `packages/cli/src/commands/companies/create.ts:59-70` | Passes only company fields to `ctx.api.companies.create()`. |
| Contacts command (separate) | `packages/cli/src/commands/contacts/create.ts:32-48` | Already requires `--company`, `--email`, `--first-name`, `--last-name`, `--type`. The remediation path partners currently use after `companies create` returns Inactive. |

The status field on the response (`packages/cli/src/commands/companies/create.ts:86`) surfaces "Inactive" to the user after a successful-looking create — but only when the user prints non-JSON output, and only if they read it. Agents reading `--json` get a `status: "Inactive"` field that they have no reason to flag as an error.

---

## Why this is publish-blocking

Two factors compound:

1. **Silent failure.** The command exits 0, the spinner shows `Company created 🎉`, and the JSON output looks valid. The breakage only surfaces downstream — when a subscription, order, or quote against the Inactive company fails for reasons that look unrelated.
2. **Agents read the flag list as the contract.** A flag list with no contact fields tells the agent "creating a company doesn't need a contact." That is the exact misrepresentation the agent-friendly surface is supposed to prevent.

Same class of bug as #307 (quotes wire-path): correct intent, stale wire layer, no test exercising the real API.

---

## CLI design (final, spec-verified)

Use the optional `contacts: [...]` array on the existing `POST /companies`. There is no separate atomic endpoint — the same `POST /companies` accepts an optional `contacts` array, and including a properly-typed contact flips the new company from Inactive to Active at creation.

**Required flags on the default (atomic) path:**

- `--first-name <name>` (spec-required)
- `--last-name <name>` (spec-required)
- `--email <email>` (spec-required)
- `--phone <phone>` (spec-required — Franco's original recommendation missed this; same gap that hit standalone `contacts create` before #325 fixed it)

`--type` is **not** a required flag. The CLI implicitly sets the supplied contact as `primary: true` for **all three** contact types (`Admin`, `Billing`, `Technical`). Per Pax8's API Reference: *"one contact with all three types and marked as primary for each type is sufficient"* for activation. The common case for the atomic path is one human runs the new company; requiring partners to enumerate three types adds verbosity without value. Partners needing separate contacts per type can use `pax8 contacts add` after creation.

**Constructed request body shape:**

```json
{
  "name": "...",
  "phone": "...",
  "website": "...",
  "address": { "street": "...", "city": "...", "stateOrProvince": "...", "postalCode": "...", "country": "US" },
  "billOnBehalfOfEnabled": false,
  "selfServiceAllowed": false,
  "orderApprovalRequired": false,
  "contacts": [{
    "firstName": "...",
    "lastName": "...",
    "email": "...",
    "phone": "...",
    "types": [
      { "type": "Admin",     "primary": true },
      { "type": "Billing",   "primary": true },
      { "type": "Technical", "primary": true }
    ]
  }]
}
```

**Opt-out flag for the company-only path:**

- `--company-only` — creates the company without the `contacts` array. Prints a loud warning: company will be Inactive, will not appear in the portal or support orders, will block re-creation with "already exists" until primary contacts are added via `pax8 contacts add`.

The `--company-only` path sends `POST /companies` without the `contacts` field at all (not with an empty `contacts: []`), matching the current CLI behavior plus the warning.

**Phone overlap simplification.** The contact's `phone` and the company's `phone` might legitimately differ. For v0.1.0 simplicity, the CLI sends the same `--phone` value to both fields on the atomic path. If a partner needs to differentiate, they can use `pax8 companies create --company-only` followed by `pax8 contacts add --phone <different>`. The help text surfaces this. A separate `--contact-phone` flag is deferred.

This is a breaking change for any script using `companies create`. Pre-1.0; acceptable.

---

## Implementation

### Step 1 — API client (`packages/core/src/api/companies.ts`)

Extend `CompaniesApi.create()` to accept an optional `contacts` payload alongside company fields. The same `POST /companies` accepts both shapes. Add an inline comment citing PAM-997 + Franco's review + Rovo activation findings so a future contributor doesn't quietly revert.

### Step 2 — CLI command (`packages/cli/src/commands/companies/create.ts`)

- Add `--first-name`, `--last-name`, `--email` as required flags on the default path. `--phone` already exists for the company phone — reuse it (the CLI sends the same value to both the company and contact `phone` fields on the atomic path; help text notes the overlap).
- Add `--company-only` as the opt-out boolean flag.
- On the default path, construct the `contacts: [...]` payload with `types: [{Admin, primary: true}, {Billing, primary: true}, {Technical, primary: true}]`.
- On `--company-only`, send `POST /companies` without `contacts` and print the loud Inactive warning verbatim (see below) to stderr before the confirm prompt.
- Reuse `Admin | Billing | Technical` enum validation from `packages/cli/src/commands/contacts/create.ts` (`17,19-30,54-73`) — don't fork it.
- Update `.description()` and `addHelpText("after", ...)` to say in plain language: *"Every company in Pax8 must have a primary contact on each of Admin, Billing, and Technical to be active. This command creates both in one call."* Cite PAM-997 / the API Reference in the help footer.

**Verbatim warning text for `--company-only`:**

```
⚠️  Creating company WITHOUT primary contacts.

This company will be created in Inactive state. It:
  - Will NOT appear in the Pax8 portal
  - Will NOT support orders, subscriptions, or quotes
  - Will block re-creation with "already exists" until primary contacts are added

To activate, add contacts via:
    pax8 contacts add --company <id> --first-name X --last-name Y --email Z --phone W --type Admin,Billing,Technical

Or omit --company-only on this command to add primary contacts atomically.
```

### Step 3 — Body shape

- Default path: `{ name, phone, website, address, billOnBehalfOfEnabled, selfServiceAllowed, orderApprovalRequired, contacts: [{firstName, lastName, email, phone, types: [{type, primary: true} × 3]}] }`.
- Company-only path: `{ name, phone, website, address, billOnBehalfOfEnabled, selfServiceAllowed, orderApprovalRequired }` (no `contacts` key).

### Step 4 — Schema review

Extend `CreateCompanyInputSchema` in `packages/core/src/api/types.ts` to accept an optional `contacts: [{...}]` array. Reuse the `ContactType` object shape `{type, primary}` from #325's body-shape fix.

### Step 5 — Tests

- **Unit test** (`packages/core/src/api/companies.test.ts`): the `POST /companies` body carries both company fields and a properly-shaped `contacts` array on the default path (all three types with `primary: true`); carries no `contacts` field on the `--company-only` path.
- **CLI integration test** (`packages/cli/src/__tests__/companies.test.ts`): under `PAX8_DEMO=1`, `companies create` with all required flags produces a company in `Active` state.
- **CLI integration test**: `companies create` without contact flags and without `--company-only` fails CLI-side validation before any wire call.
- **CLI integration test**: `companies create --company-only` prints the verbatim warning to stderr before the confirm prompt.
- **CLI integration test**: `--company-only` does NOT require the contact flags.
- **Regression assertion**: `POST /companies` without `contacts` is never called on the default path.

Demo mode is the test posture. `MockPax8Client` needs to model the contacts-bearing request body and return an `Active`-status company.

### Step 6 — Domain review doc

The Companies & Contacts section gets a parallel **"Open from review"** → **"What changed since your feedback"** entry after this lands.

### Step 7 — Changeset

```
---
"@pax8/cli": minor
"@pax8/core": minor
---

`pax8 companies create` now creates Active companies by default via the
atomic contacts-array pattern (PAM-997 / PAM-1171 / ARC-774). The same
`POST /companies` accepts an optional `contacts: [...]` array; including a
properly-typed primary contact flips the new company from Inactive to
Active at creation. New required flags on the default (atomic) path:
`--first-name`, `--last-name`, `--email`, `--phone`. The supplied contact
is implicitly set as `primary: true` for all three ContactType values
(Admin, Billing, Technical), matching the API Reference's activation
guidance. Opt-out via `--company-only` produces an Inactive company with
a loud warning. Previously the CLI was calling a contact-less path that
left companies in `Inactive` state — discovered by Franco Aurieme during
domain review.
```

---

## Out of scope

- `companies update` having an equivalent atomic path. Separate question; file separately if it exists.
- A dedicated `--contact-phone` flag for distinguishing company phone from contact phone. Deferred; partners needing differentiation use `--company-only` + `pax8 contacts add`.
- Auditing every other CLI command for "calls a legacy endpoint where an atomic/improved one exists." Belongs in the parallel audit issue.
- Renaming or restructuring `contacts create` / `contacts add`.

## Acceptance criteria

- [ ] `companies create` sends `POST /companies` with a `contacts: [...]` array on the default path.
- [ ] The CLI sets `primary: true` on `Admin`, `Billing`, and `Technical` types for the supplied contact.
- [ ] `--first-name`, `--last-name`, `--email`, `--phone` are required on the default path, validated CLI-side before any wire call.
- [ ] `--company-only` is supported as an opt-out and sends `POST /companies` without the `contacts` field.
- [ ] `--company-only` is NOT required to be combined with the contact flags (the warning + confirm flow gates the user).
- [ ] Help text on `companies create` makes the activation requirement explicit.
- [ ] Tests cover both paths and assert the wire body shape.
- [ ] `CompanySchema` (and any new input schema) matches the spec's request and response shapes.
- [ ] Domain review doc updated.
- [ ] Changeset landed.
- [ ] CI green (`pnpm build && pnpm test && pnpm lint`).

## Closes / relates

- Closes: Franco Aurieme's domain-review comment on Companies & Contacts.
- Activation behavior verified: Rovo against Pax8 API Reference + PAM-997 + ARC-774.
- Relates: #307 (quotes wire-path) — same class of bug.
- Relates: parallel audit issue (legacy-endpoint sweep).
