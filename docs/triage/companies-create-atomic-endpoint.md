# fix(companies): `companies create` calls the legacy two-step path, leaving companies Inactive

**Priority:** P0 — publish-blocking
**Class:** CLI built against a stale API picture (same class as #307 quotes wire-path)
**Reporter:** Franco Aurieme (PM, Account Management), via domain review of the Companies & Contacts section
**Confirmed by:** Vinton Lee (PAM backend) — the CLI is on the pre-PAM-997 path

---

## TL;DR

`pax8 companies create` posts to `POST /v1/companies` with company fields only (`name`, `phone`, `website`, `address`) and no contact. That is the **legacy two-step path** Pax8 deprecated under PAM-997 / PAM-1171 / ARC-774. The atomic create-with-contact endpoint that replaced it was specifically built so newly-created companies do not land in `Inactive` state. Every partner and AI agent driving `pax8 companies create` today creates an Inactive ghost client, then has to remediate with a separate `pax8 contacts create` to activate it. The CLI reports success while the company is broken — the failure is silent at the surface and only manifests when downstream operations against the Inactive company fail.

This is publish-blocking for the same reason the quotes wire-path issue was: the CLI's flag list is the contract that AI agents read, and right now it tells them a lie.

---

## Evidence — current state of the CLI

The CLI's `create` is a thin single-call wrapper around the legacy endpoint, with no contact fields on the command surface:

| Layer | File | What's there today |
|---|---|---|
| API client | `packages/core/src/api/companies.ts:29-32` | `create()` does `client.post("/companies", data)` with `CreateCompanyInput` (company-only fields). No contact payload, no atomic endpoint. |
| CLI command flags | `packages/cli/src/commands/companies/create.ts:14-22` | `--name` (required), then `--phone`, `--website`, `--city`, `--state`, `--zip`, `--country`. No `--first-name`, `--last-name`, `--email`, or `--type`. |
| CLI call site | `packages/cli/src/commands/companies/create.ts:59-70` | Passes only company fields to `ctx.api.companies.create()`. |
| Contacts command (separate) | `packages/cli/src/commands/contacts/create.ts:32-48` | Already requires `--company`, `--email`, `--first-name`, `--last-name`, `--type`. This is the command partners are *currently* expected to call as the second step. |

The status field on the response (`packages/cli/src/commands/companies/create.ts:86`) is what surfaces "Inactive" to the user after a successful-looking create — but only when the user prints non-JSON output, and only if they read it. Agents reading `--json` get a `status: "Inactive"` field that they have no reason to flag as an error.

## Why this is publish-blocking

Two factors compound:

1. **Silent failure.** The command exits 0, the spinner shows `Company created 🎉`, and the JSON output looks valid. There is no error to catch. The breakage only surfaces downstream — when a subscription, order, or quote against the Inactive company fails for reasons that look unrelated.
2. **Agents read the flag list as the contract.** A flag list with no contact fields tells the agent "creating a company doesn't need a contact." That is the exact misrepresentation the agent-friendly surface is supposed to prevent. Humans at least see the `Inactive` line and can google it; agents fire-and-forget and move on.

This is the same class of bug as #307 (quotes wire-path): correct intent, stale wire layer, no test exercising the real API. The `docs/triage/quotes-api-version.md` §10 retrospective applies directly — paper-only verification of "what the CLI sends" does not catch this.

## Decision

Update `companies create` to call the atomic create-with-contact endpoint. Surface `--first-name`, `--last-name`, `--email`, and `--type` as required flags on the same command. Keep `contacts create` for adding *subsequent* contacts to an existing company.

This is a breaking change for any script using `companies create`. Pre-1.0; acceptable.

---

## Investigate before implementation

1. **Sync with Franco and Vinton Lee.** Franco offered to walk through it. Take him up — the atomic endpoint may have nuances (required contact types, response shape, whether there is an equivalent atomic *update* path) that surface faster in conversation than from JIRA archaeology.
2. **Read the JIRA tickets.** PAM-997, PAM-1171, ARC-774. Understand the original Inactive-state regression, why the atomic path was built, and the contract it commits to.
3. **Locate the endpoint in the public spec.** Check `https://devx.pax8.com/openapi/partner-endpoints.json` for the atomic create. If the spec still documents only the legacy two-step path, that is a separate finding worth flagging to the API team — the canonical endpoint should be the one the spec promotes.

The methodology lesson from #307 applies: **verify request body shape against the spec, not just the URL.** Don't repeat the audit pattern that missed body-shape mismatches on quotes.

---

## Implementation

### Step 1 — API client (`packages/core/src/api/companies.ts`)

Replace the `POST /companies` call in `CompaniesApi.create()` with the atomic create-with-contact endpoint. The request body must carry both company fields and the first contact's fields. Add an inline comment citing PAM-997 + Franco's review so a future contributor doesn't quietly revert to the legacy path because it "looks simpler."

### Step 2 — CLI command (`packages/cli/src/commands/companies/create.ts`)

- Add `--first-name`, `--last-name`, `--email`, `--type` as **required** flags (matching `contacts create`'s existing vocabulary, see `packages/cli/src/commands/contacts/create.ts:35-39`).
- Reuse the `Admin | Billing | Technical` enum validation from `contacts create` (`packages/cli/src/commands/contacts/create.ts:17,19-30,54-73`) — don't fork it.
- Update `.description()` and `addHelpText("after", ...)` so the help output says, in plain language: *"Every company in Pax8 must have at least one contact. This command creates both in one call."* and shows examples with all four flags populated.
- Update the preview block (`create.ts:38-46`) so the contact's name, email, and types are part of what the user confirms.
- Update Zod input validation accordingly (likely a new `CreateCompanyWithContactInput` in `packages/core/src/api/types.ts`, or extend the existing `CreateCompanyInput`).

### Step 3 — Contacts create (`packages/cli/src/commands/contacts/create.ts`)

`contacts create` still works for additional contacts on an existing company; confirm with backend it does not conflict with the atomic create path. Update its `.description()` to disambiguate: *"Add an additional contact to an existing company. The first contact is created together with the company via `companies create`."*

### Step 4 — Schema review

Verify `CompanySchema` covers any fields the atomic endpoint returns that the legacy response didn't (in particular, the initial contact alongside the company). If the response shape differs, update the schema. Carry the §9.2/§10 lesson from the quotes triage: response-shape verification and request-shape verification are independent audits — finish both.

### Step 5 — Tests

- **Unit test** (`packages/core/src/api/companies.test.ts`, may need to be created): the atomic endpoint is called with both company and contact fields in the body.
- **CLI integration test** (`packages/cli/src/__tests__/companies.create.test.ts`): under `PAX8_DEMO=1`, `companies create` with all required flags produces a company in `Active` state (not `Inactive`).
- **CLI integration test**: `companies create` without contact flags fails CLI-side validation before any wire call, with an actionable error and the correct exit code.
- **Regression assertion**: the legacy `POST /v1/companies` *without* a contact body is never called — either by asserting on the request body shape in the unit test, or by removing the legacy code path entirely so the regression is structurally impossible.

Demo mode is the test posture (`CLAUDE.md` — "Demo mode is the test posture, not a side project"). The mock client (`MockPax8Client`) needs to model the atomic endpoint and return an `Active`-status company.

### Step 6 — Domain review doc

The Orders & Quotes section was updated for the quotes audit findings; the Companies & Contacts section needs a parallel **"Open from review"** entry citing Franco's catch. After the fix lands, the entry moves to **"What changed since your feedback"** with a PR link.

### Step 7 — Changeset

```
Fix: `companies create` now uses the atomic create-with-contact endpoint
shipped under PAM-997. New required flags: `--first-name`, `--last-name`,
`--email`, `--type`. Previously, the CLI was calling a legacy two-step path
that left companies in `Inactive` state — discovered by Franco Aurieme during
domain review. AI agents and scripts using the prior surface should be
updated to pass the new required flags.
```

---

## Out of scope

- `companies update` having an equivalent atomic path. Likely a separate question — confirm with Franco/Vinton during the sync. If one exists, file separately.
- Auditing every other CLI command for "calls a legacy endpoint where an atomic/improved one exists." That belongs in the parallel audit issue; the audit methodology should explicitly include this case (legacy-endpoint usage where an atomic alternative exists). See the §10 retrospective in `docs/triage/quotes-api-version.md` for the verification pattern.
- Renaming or restructuring `contacts create`.

## Acceptance criteria

- [ ] `companies create` calls the atomic create-with-contact endpoint, not the legacy two-step path.
- [ ] `--first-name`, `--last-name`, `--email`, `--type` are required flags on `companies create`, validated CLI-side before any wire call.
- [ ] Help text on both `companies create` and `contacts create` makes the relationship between the two explicit.
- [ ] Tests cover the atomic path and assert the legacy path is never called.
- [ ] `CompanySchema` (and any new input schema) matches the atomic endpoint's request and response shapes.
- [ ] Domain review doc updated: Companies & Contacts section has the "Open from review" → "What changed" entry.
- [ ] Changeset landed under `.changeset/`.
- [ ] CI green (`pnpm build && pnpm test && pnpm lint`).

## Closes / relates

- Closes: Franco Aurieme's domain-review comment on Companies & Contacts (link once doc is published).
- Relates to: #307 (quotes wire-path fix) — same class of bug; the §10 retrospective in `docs/triage/quotes-api-version.md` captures the verification methodology this issue's investigation should follow.
- Relates to: parallel audit issue (legacy-endpoint sweep) — methodology must explicitly look for "legacy endpoint used when an atomic alternative exists," not only "endpoint not found."
