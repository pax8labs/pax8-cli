# Companies write API audit

**TL;DR:** Both write operations hit URLs that exist on the Pax8 v1 API, so the URL story is clean (this is **not** the quotes-style v1-vs-v2 problem). But both operations send a **request body that does not match the OpenAPI schema** — the `address` sub-object uses CLI-invented field names (`state`, `zip`) instead of the spec's `stateOrProvince`, `postalCode`. In addition, `companies update` calls `PUT /companies/{id}` while the spec only documents `PATCH /companies/{companyId}`, and `companies create` always sends an `address` object even when the user supplies no address flags. Verdicts: `create` = **case B' (body-shape bug, address field names)**; `update` = **case B+B' (wrong HTTP method AND body-shape bug)**.

## Operations audited

| Operation | CLI command | CLI wire | Spec path | Spec method | Verdict |
|---|---|---|---|---|---|
| Create company | `pax8 companies create` | `POST {baseUrl}/companies` | `/companies` | `post` | B' — URL correct, body shape wrong (`state`/`zip` vs `stateOrProvince`/`postalCode`; always sends `address` even when empty) |
| Update company | `pax8 companies update <id\|name>` | `PUT {baseUrl}/companies/{id}` | `/companies/{companyId}` | `patch` | B + B' — wrong HTTP method (PUT vs PATCH) AND body shape wrong (address field names) |

`{baseUrl}` resolves to `https://api.pax8.com/v1` by default (`packages/core/src/api/client.ts:20`, `getDefaultBaseUrl()` at lines 37–41). `PAX8_API_BASE` can override but must validate as `https://` (or localhost http) per `validateBaseUrl`.

## Operation: companies create

### Wire path

1. CLI handler: `packages/cli/src/commands/companies/create.ts:59–70` calls `ctx.api.companies.create({ name, phone, website, address: {...} })`.
2. Core method: `packages/core/src/api/companies.ts:29–32` — `create(data)` calls `this.client.post<unknown>("/companies", data)`.
3. HTTP client: `packages/core/src/api/client.ts:91–93` — `post(path, body)` → `request("POST", path, body)`. `buildUrl` at lines 267–278 builds `new URL(\`${this.baseUrl}${path}\`)`, with `baseUrl` defaulting to `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` (line 20).
4. **Resolved wire URL:** `POST https://api.pax8.com/v1/companies`.

### Public spec location

- Path: `paths."/companies"` exists in `/tmp/partner-endpoints.json`.
- Method: `post` (operationId `createCompany`, tags `Companies`).
- Server: `servers[0].url = "https://api.pax8.com/v1"` (info.version `1.0.0`).
- **The URL is correct.** No v1-vs-v2 problem here.

### Request body shape

**CLI sends** (`packages/cli/src/commands/companies/create.ts:59–70`):

```jsonc
{
  "name": "<--name>",
  "phone": "<--phone or ''>",
  "website": "<--website or ''>",
  "address": {
    "street": "",                              // always empty string — no --street flag
    "city":    "<--city or ''>",
    "state":   "<--state or ''>",              // !! CLI invented field name
    "zip":     "<--zip or ''>",                // !! CLI invented field name
    "country": "<--country or 'US'>"
  }
}
```

The Zod input schema enforcing this shape is `AddressSchema` / `CreateCompanyInputSchema` at `packages/core/src/api/types.ts:56–99`.

**Spec requires** (`paths."/companies".post.requestBody.content."application/json".schema` → `$ref components.schemas.Company`):

- `required`: `["name", "address", "phone", "website", "billOnBehalfOfEnabled", "selfServiceAllowed", "orderApprovalRequired"]`.
- `address` is `$ref components.schemas.Address` with properties: `street`, `street2`, `city`, **`stateOrProvince`**, **`postalCode`**, `country` (ISO 3166-1 alpha-2, regex `^[A-Z]{2}$`).
- Spec example payload (`components.examples.company-post`):
  ```json
  {
    "name": "VFC Network, Inc",
    "address": {
      "street": "48918 Liberty Lane Ave",
      "city": "Denver",
      "postalCode": "80210",
      "country": "US",
      "stateOrProvince": "Colorado"
    },
    "phone": "123-456-5555",
    "website": "vfc-network-inc-liberty.com",
    "externalId": "A123",
    "selfServiceAllowed": false,
    "billOnBehalfOfEnabled": false,
    "orderApprovalRequired": false,
    "contacts": [ ... ]
  }
  ```

**Mismatches:**

1. **Address field-name mismatch (B'):** CLI sends `address.state` and `address.zip`; spec defines `address.stateOrProvince` and `address.postalCode`. Same nesting (both flat-under-`address`), but the leaf names disagree. The API will either reject as 422 or silently discard those fields and store the company with an empty state/zip — neither is acceptable.
2. **Always-present empty address (likely B'):** The handler unconditionally sends an `address` object with all fields defaulting to `""` (lines 63–69). Even when the user supplies no `--city`/`--state`/`--zip`, the body has `address: { street: "", city: "", state: "", zip: "", country: "US" }`. The spec marks `address` as a required parent, but its leaf properties have no `pattern`/`minLength` declared — except `country` (`^[A-Z]{2}$`) which the `"US"` default satisfies. So this is more of a quality concern than a hard 422, but it makes the CLI ship dummy address data on every create.
3. **Missing required boolean fields (B'):** Spec marks `billOnBehalfOfEnabled`, `selfServiceAllowed`, `orderApprovalRequired` as **required**. The CLI exposes no flags for them and never sends them. The Zod `CreateCompanyInputSchema` lists them as `.optional()` (`packages/core/src/api/types.ts:95–97`), confirming the omission is by design. The API may default these server-side (the partner UI lets you create a company without them), but per the spec contract they should be in the request body.
4. **No `--street` / `--street2` / `--external-id` flags:** Spec accepts `street`, `street2`, `externalId`; CLI hard-codes `street: ""` and omits the others. Not a "wrong" finding per se (extras are optional) but it's coverage debt.

### Required field coverage

For create, the spec's `required` list is `[name, address, phone, website, billOnBehalfOfEnabled, selfServiceAllowed, orderApprovalRequired]`.

| Spec required | CLI sends? | Notes |
|---|---|---|
| `name` | yes (required flag) | OK |
| `address` | yes (always — empty object even when no flags) | Present-but-degenerate |
| `phone` | yes (defaults to `""` if `--phone` omitted) | Empty string |
| `website` | yes (defaults to `""`) | Empty string |
| `billOnBehalfOfEnabled` | **no** | No CLI flag |
| `selfServiceAllowed` | **no** | No CLI flag |
| `orderApprovalRequired` | **no** | No CLI flag |

Three required-by-spec boolean fields are silently omitted.

### Reconciliation case (A–E, or B'/B+B')

**Case B' (body-shape bug).** The URL is correct (v1 path, no version drift), but the request body diverges from the OpenAPI request schema in three ways:

- Address field names: `state`/`zip` instead of `stateOrProvince`/`postalCode`.
- Three required boolean fields (`billOnBehalfOfEnabled`, `selfServiceAllowed`, `orderApprovalRequired`) are never sent.
- A dummy empty `address` object is always sent even when the user supplies no address flags.

Borderline B+B' if you consider the missing required fields a structural omission rather than a shape mismatch. Either label points at the same fix.

### Recommendation

1. Rename `AddressSchema` fields in `packages/core/src/api/types.ts:56–62` to match the spec: `street`, `street2?`, `city`, `stateOrProvince`, `postalCode`, `country`. Update `companies create` flags accordingly (`--state` → still UX-fine but maps to `stateOrProvince` on the wire; `--zip` → maps to `postalCode`).
2. Stop unconditionally building an `address` object when no address flags were supplied (`packages/cli/src/commands/companies/create.ts:63–69`). Omit `address` from the body in that case, or fail-fast with an `ERROR_INVALID_INPUT` since the spec marks `address` required.
3. Add CLI flags for the three required booleans (e.g. `--bill-on-behalf-of`, `--self-service-allowed`, `--order-approval-required`) with sensible defaults, OR send them as `false` defaults explicitly. The current "rely on server defaults" approach is invisible to operators and not contractually safe.
4. (Nice-to-have) Add `--external-id`, `--street`, `--street2` flags so partners using PSA-bridging can do create-with-`externalId` from the CLI, matching the `externalId` field already in `CompanySchema` (`packages/core/src/api/types.ts:84`).

## Operation: companies update

### Wire path

1. CLI handler: `packages/cli/src/commands/companies/update.ts:30–74`. Builds `updates: Record<string, unknown>` containing only the user-supplied flags (`name`, `phone`, `website`) at lines 36–39, then calls `ctx.api.companies.update(resolved.id, updates)` at line 71.
2. Core method: `packages/core/src/api/companies.ts:34–37` — `update(id, data)` calls `this.client.put<unknown>(\`/companies/${id}\`, data)`. **Note the verb: PUT.**
3. HTTP client: `packages/core/src/api/client.ts:95–97` — `put(path, body)` → `request("PUT", path, body)`. Same `buildUrl` machinery as create.
4. **Resolved wire URL:** `PUT https://api.pax8.com/v1/companies/{id}`.

Test confirms verb is PUT: `packages/core/src/api/companies.test.ts:82` asserts `client.put` is invoked.

### Public spec location

- Path: `paths."/companies/{companyId}"` exists.
- Methods documented: `get`, **`patch`** (operationId `updateCompany`, summary "Update Company"). **No `put`.**
- Spec description for PATCH: "Updates an existing Company. ATTENTION - at least one parameter has to be modified."

### Request body shape

**CLI sends** (`packages/cli/src/commands/companies/update.ts:36–39, 71`):

```jsonc
// Only keys whose flags were passed:
{
  "name":    "<--name>",     // if --name passed
  "phone":   "<--phone>",    // if --phone passed
  "website": "<--website>"   // if --website passed
}
```

There is **no fetch-then-merge**. `resolveCompany` (`packages/cli/src/lib/resolve-company.ts`) returns the full Company for ID/name lookup, but the handler only consults `resolved.id` (line 71) and `resolved.name` (line 54, display only). The existing field values are never spliced into the request body.

**Spec defines** (`paths."/companies/{companyId}".patch.requestBody.content."application/json".schema` → `$ref components.schemas.CompanyUpdate`):

- `type: object`, **no `required` list** (genuine partial-update schema).
- Properties: `id` (readOnly), `name`, `address` (`$ref Address`), `phone`, `website`, `externalId`, `billOnBehalfOfEnabled`, `selfServiceAllowed`, `orderApprovalRequired`, `status` (readOnly).
- `Address` properties: `street`, `street2`, `city`, **`stateOrProvince`**, **`postalCode`**, `country`.

**Mismatches:**

1. **HTTP method (B):** CLI uses **PUT**, spec documents **PATCH**. This is a verb-level wire mismatch. Per typical Pax8 routing, the API may either reject PUT with 405 Method Not Allowed, or accept it as an alias — unverified, but the public contract is PATCH-only.
2. **Address field-name mismatch (B'):** Same issue as create — though `companies update` exposes no address flags today (only `--name`, `--phone`, `--website`), so the address divergence is dormant. The moment someone adds `--state`/`--zip` flags, it would manifest the same `state` vs `stateOrProvince` problem.
3. **Body-direction is fine:** The CLI sends a true partial body (only modified fields), which matches the PATCH semantics declared in the spec ("at least one parameter has to be modified"). If the API really is PATCH, then partial-send is correct and a fetch-then-merge would actually be *wrong*. So if the verb is fixed to PATCH, the partial-body approach is right; if the API only accepts PUT-with-full-replace, then both the verb AND the missing-field merge are bugs. The spec says PATCH, so I'm treating the verb as the primary fault.

### Required field coverage

- Spec method is **PATCH**, not PUT. `CompanyUpdate` schema declares **no required fields** (it's a partial-update schema, properties only).
- The only spec-imposed constraint is "at least one parameter has to be modified" — the CLI enforces this at the handler level (lines 41–49), throwing `ERROR_INVALID_INPUT` if no flags were passed. Good.
- The CLI does **not** fetch-then-merge. It sends only the user-supplied fields. That matches PATCH semantics. It would be wrong for PUT (full-replace).

So: **partial body is correct iff the verb is PATCH.** Since the spec says PATCH, the partial-body approach is fine; the verb is the bug.

### Reconciliation case (A–E, or B'/B+B')

**Case B + B' (wrong HTTP method, plus body-shape bug latent in address).**

- B (wrong wire-level method): the CLI hits `PUT /companies/{id}`, the spec documents `PATCH /companies/{companyId}` only. URL path is right; verb is wrong.
- B' (body shape): the `AddressSchema` field names (`state`, `zip` vs spec `stateOrProvince`, `postalCode`) are wrong, but currently dormant because the update command exposes no address flags. As soon as address flags are added, this becomes active.

### Recommendation

1. Change `CompaniesApi.update` (`packages/core/src/api/companies.ts:34–36`) from `this.client.put(...)` to `this.client.patch(...)`. The PATCH method already exists on `Pax8Client` (`packages/core/src/api/client.ts:99–101`).
2. Update the companies test (`packages/core/src/api/companies.test.ts:82`) to assert `client.patch` instead of `client.put`. Keep the partial-body assertion.
3. Fix the `AddressSchema` field names in `packages/core/src/api/types.ts:56–62` (same change as for create) so future `--state-or-province` / `--postal-code` (or remapped `--state`/`--zip`) flags will serialize correctly.
4. Keep the partial-update approach in the CLI handler. Do **not** introduce a fetch-then-merge — the spec is PATCH, partial is correct.

## Constraints honored

- READ-ONLY audit: no source-tree files in `packages/` were modified. Only `docs/triage/api-version-audit/companies.md` was written.
- All CLI claims cite worktree-relative file paths and line numbers (e.g. `packages/cli/src/commands/companies/update.ts:71`).
- All API claims cite the OpenAPI spec by JSON path (e.g. `paths."/companies/{companyId}".patch`) or `components.schemas.{Company,CompanyUpdate,Address}` / `components.examples.{company-post, company-update-post}`.
- Request body shapes derived from `requestBody.content."application/json".schema` (resolved through `$ref`s), not from response examples. (Response examples were consulted only as cross-check confirmation; they happen to use the same `Address` field names.)
- No live API calls were made.
- Worktree path used throughout: `/tmp/pax8-cli-api-audit/`. Did not touch `/Users/jdulberger/Documents/pax8-cli`.
