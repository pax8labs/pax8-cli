# fix(companies): `companies create` calls the legacy two-step path, leaving companies Inactive

**Priority:** P0 — publish-blocking
**Class:** CLI built against a stale API picture (same class as #307 quotes wire-path)
**Reporter:** Franco Aurieme (PM, Account Management), via domain review of the Companies & Contacts section
**Confirmed by:** Vinton Lee (PAM backend), Mari Astapova (PAM-997)
**Activation behavior verified by:** Rovo against Pax8 API Reference + PAM-997 + ARC-774

---

## TL;DR

`pax8 companies create` posts to `POST /v1/companies` with company fields only (`name`, `phone`, `website`, `address`) and no `contacts` payload. This path leaves the company in `Inactive` state because Pax8 requires a primary contact for each of three types (`Admin`, `Billing`, `Technical`) before a company activates. The atomic create-with-contact behavior — passing a `contacts: [...]` array in the same `POST /companies` body — was added under PAM-997 specifically so the partner doesn't have to stage two-plus calls and risk leaving a ghost client.

Every partner and AI agent driving `pax8 companies create` today creates an Inactive ghost client, then has to remediate. The CLI reports success while the company is broken — the failure is silent at the surface and only manifests when downstream operations against the Inactive company fail.

This is publish-blocking for the same reason the quotes wire-path issue was: the CLI's flag list is the contract that AI agents read, and right now it tells them a lie.

---

## Activation requirements (verified via Rovo / Pax8 API Reference)

The company activates only when it has at least one contact with `primary: true` on **each** of the three contact types: `Admin`, `Billing`, `Technical`.

**Sources:**

- **Pax8 API Reference PDF:** *"A Company is required to have a primary Contact for each Contact Type ('Admin', 'Billing', 'Technical'). One contact with all three types and marked as primary for each type is sufficient."*
- **PAM-997 (Mari Astapova's confirmation comment):** *"We implemented changes to the public API for company creation to support passing a contact in the payload. This enables a company to be created in an Active state immediately."*
- **ARC-774** — architecture review confirming the activation gate

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

## CLI design

**Default (atomic) path** — required flags:

- `--first-name <name>` (spec-required)
- `--last-name <name>` (spec-required)
- `--email <email>` (spec-required)
- `--phone <phone>` (spec-required — Franco's original recommendation missed this; same gap that hit standalone `contacts create` before #325 fixed it)

The CLI implicitly sets the supplied contact as `primary: true` for all three contact types (`Admin`, `Billing`, `Technical`). No `--type` flag is exposed. Rationale: activation requires primary on each type; the common case is one human runs the new company; partners needing per-type contact distribution use `pax8 contacts add` after creation.

**Constructed request body:**

```json
{
  "name": "...",
  "address": { ... },
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

This is a breaking change for any script using `companies create`. Pre-1.0; acceptable.

---

## Implementation

### Step 1 — API client (`packages/core/src/api/companies.ts`)

Extend `CompaniesApi.create()` to accept an optional `contacts` payload alongside company fields. The same `POST /companies` accepts both shapes. Add an inline comment citing PAM-997 + Franco's review + Rovo activation findings so a future contributor doesn't quietly revert.

### Step 2 — CLI command (`packages/cli/src/commands/companies/create.ts`)

- Add `--first-name`, `--last-name`, `--email`, `--phone` as required flags on the default path.
- Add `--company-only` as the opt-out boolean flag.
- Validate that `--company-only` is mutually exclusive with `--first-name` / `--last-name` / `--email` / `--phone` (you either supply a contact or you don't).
- On the default path, construct the `contacts: [...]` payload with `types: [{Admin, primary: true}, {Billing, primary: true}, {Technical, primary: true}]`.
- On `--company-only`, send `POST /companies` without `contacts` and print the loud Inactive warning.
- Reuse `Admin | Billing | Technical` enum validation from `packages/cli/src/commands/contacts/create.ts` (`17,19-30,54-73`) — don't fork it.
- Update `.description()` and `addHelpText("after", ...)` to say in plain language: *"Every company in Pax8 must have a primary contact on each of Admin, Billing, and Technical to be active. This command creates both in one call."*

### Step 3 — Body shape

- Default path: `{ name, address, contacts: [{firstName, lastName, email, phone, types: [{type, primary: true} × 3]}] }`.
- Company-only path: `{ name, address }` (no `contacts` key).

### Step 4 — Schema review

Verify `CompanySchema` covers any fields the atomic-with-contact response returns that the contact-less response didn't (in particular, the initial contact alongside the company). Extend or add `CreateCompanyWithContactInput` in `packages/core/src/api/types.ts` to match.

### Step 5 — Tests

- **Unit test** (`packages/core/src/api/companies.test.ts`): the `POST /companies` body carries both company fields and a properly-shaped `contacts` array on the default path; carries no `contacts` field on the `--company-only` path.
- **CLI integration test** (`packages/cli/src/__tests__/companies.create.test.ts`): under `PAX8_DEMO=1`, `companies create` with all required flags produces a company in `Active` state.
- **CLI integration test**: `companies create` without contact flags and without `--company-only` fails CLI-side validation before any wire call.
- **CLI integration test**: `companies create --company-only` produces an `Inactive` company and prints the warning.
- **Regression assertion**: `POST /companies` without `contacts` is never called on the default path.

Demo mode is the test posture. `MockPax8Client` needs to model the contacts-bearing request body and return an `Active`-status company.

### Step 6 — Domain review doc

The Companies & Contacts section gets a parallel **"Open from review"** → **"What changed since your feedback"** entry after this lands.

### Step 7 — Changeset

```
Fix: `pax8 companies create` now uses the atomic create-with-contact behavior
on the same `POST /companies` endpoint, so newly-created companies land in
`Active` state instead of `Inactive`. New required flags: `--first-name`,
`--last-name`, `--email`, `--phone`. The CLI sets the supplied contact as
primary on all three contact types (Admin, Billing, Technical) — activation
requires one primary per type, per the Pax8 API Reference. New opt-out flag
`--company-only` preserves the contact-less single-call behavior with a
loud warning. Previously, the CLI was calling the contact-less path that
left companies in `Inactive` state — discovered by Franco Aurieme during
domain review.
```

---

## Out of scope

- `companies update` having an equivalent atomic path. Separate question; file separately if it exists.
- Auditing every other CLI command for "calls a legacy endpoint where an atomic/improved one exists." Belongs in the parallel audit issue.
- Renaming or restructuring `contacts create` / `contacts add`.

## Acceptance criteria

- [ ] `companies create` sends `POST /companies` with a `contacts: [...]` array on the default path.
- [ ] The CLI sets `primary: true` on `Admin`, `Billing`, and `Technical` types for the supplied contact.
- [ ] `--first-name`, `--last-name`, `--email`, `--phone` are required on the default path, validated CLI-side before any wire call.
- [ ] `--company-only` is supported as an opt-out and sends `POST /companies` without the `contacts` field.
- [ ] `--company-only` is mutually exclusive with the contact flags.
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
