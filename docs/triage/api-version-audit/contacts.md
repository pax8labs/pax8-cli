# Contacts write API audit

**TL;DR:** All three contact write commands hit the **wrong wire URL** — the CLI uses flat `/contacts/...` paths but the public spec only documents the nested `/companies/{companyId}/contacts/...` form (no flat path exists in `partner-endpoints.json`). `contacts create` POSTs to `/v1/contacts` (spec: `POST /v1/companies/{companyId}/contacts`) and additionally carries the `companyId` in the body instead of the URL — a body field the spec does not declare. `contacts update` PUTs to `/v1/contacts/{id}` (spec: `PUT /v1/companies/{companyId}/contacts/{contactId}`) and sends a partial body; the spec's PUT request body has four required scalars (`firstName`, `lastName`, `email`, `phone`), so a partial PUT would 422 against a strict implementation, and the spec does not document PATCH. `contacts delete` DELETEs `/v1/contacts/{id}` (spec: `DELETE /v1/companies/{companyId}/contacts/{contactId}`). The **most-surprising and load-bearing body finding**: the spec types each `types` element as an **object** `{type: "Admin"|"Billing"|"Technical", primary: boolean}`, but the CLI sends a flat array of strings (`types: ["Admin", "Billing"]`). This is a structural body-shape mismatch that a URL-only audit would have missed.

## Operations audited

| Command | Source file:lines | CLI-resolved URL | Spec-documented URL | HTTP method |
|---|---|---|---|---|
| `pax8 contacts create` | `packages/cli/src/commands/contacts/create.ts:107` → `packages/core/src/api/contacts.ts:32-35` | `POST https://api.pax8.com/v1/contacts` | `POST https://api.pax8.com/v1/companies/{companyId}/contacts` | `POST` |
| `pax8 contacts update <id>` | `packages/cli/src/commands/contacts/update.ts:117` → `packages/core/src/api/contacts.ts:37-40` | `PUT https://api.pax8.com/v1/contacts/{id}` | `PUT https://api.pax8.com/v1/companies/{companyId}/contacts/{contactId}` | `PUT` (spec is PUT, no PATCH variant) |
| `pax8 contacts delete <id>` | `packages/cli/src/commands/contacts/delete.ts:55` → `packages/core/src/api/contacts.ts:42-44` | `DELETE https://api.pax8.com/v1/contacts/{id}` | `DELETE https://api.pax8.com/v1/companies/{companyId}/contacts/{contactId}` | `DELETE` |

Wire-URL trace (shared):
- `Pax8Client` constructor sets `this.baseUrl = (options.baseUrl ?? getDefaultBaseUrl()).replace(/\/+$/, "")` at `packages/core/src/api/client.ts:53`.
- `getDefaultBaseUrl()` returns `FALLBACK_BASE_URL = "https://api.pax8.com/v1"` when `PAX8_API_BASE` is unset (`packages/core/src/api/client.ts:20`, `37-41`).
- `buildUrl(path, params)` concatenates `${this.baseUrl}${normalizedPath}` (`packages/core/src/api/client.ts:267-278`) — no path rewriting, no version override.
- `ContactsApi` passes literal relative paths beginning with `/contacts` to `client.post/put/delete` (`packages/core/src/api/contacts.ts:33, 38, 43`). It never templates `companyId` into the path.

Spec server: `partner-endpoints.json .servers[0].url = "https://api.pax8.com/v1"` (so the spec is unambiguously talking about `/v1`).

Spec paths (full enumeration of contact endpoints — there are no flat sibling paths):
```
$ jq '.paths | keys[] | select(test("contact"; "i"))' /tmp/partner-endpoints.json
"/companies/{companyId}/contacts"
"/companies/{companyId}/contacts/{contactId}"
```

---

## Operation: contacts create

### Wire path
CLI hits `POST https://api.pax8.com/v1/contacts`.
- Command handler calls `ctx.api.contacts.create(input)` at `packages/cli/src/commands/contacts/create.ts:107`.
- `ContactsApi.create` calls `this.client.post<unknown>("/contacts", data)` at `packages/core/src/api/contacts.ts:33`.
- `client.post` issues `POST` to `buildUrl("/contacts")` → `https://api.pax8.com/v1/contacts` (`packages/core/src/api/client.ts:91-93`, `267-278`).

### Public spec location
The spec documents creation at `partner-endpoints.json paths."/companies/{companyId}/contacts".post` (summary: "Create Contact"). It declares `companyId` as a **required path parameter** (`type: string, format: uuid`). There is no flat `/contacts` POST in the spec — confirmed by the path-key enumeration above.

### Request body shape
CLI body construction (`packages/cli/src/commands/contacts/create.ts:94-101`):
```
const input: CreateContactInput = {
  firstName: options.firstName,
  lastName:  options.lastName,
  email:     options.email,
  companyId: company.id,         // <-- companyId carried in body
  types,                         // <-- string[]: e.g. ["Admin", "Billing"]
  ...(options.phone ? { phone: options.phone } : {}),
};
```
Zod input contract (`packages/core/src/api/types.ts:125-133`):
```
export const CreateContactInputSchema = z.object({
  firstName: z.string().min(1),
  lastName:  z.string().min(1),
  email:     z.string().email(),
  phone:     z.string().optional(),
  companyId: z.string(),
  types:     z.array(ContactTypeSchema).min(1),   // ContactTypeSchema = z.enum(["Admin","Billing","Technical"])
});
```
The spec's `requestBody.content."application/json".schema` resolves via `$ref` to `#/components/schemas/Contact` (`partner-endpoints.json paths."/companies/{companyId}/contacts".post.requestBody`). The resolved `Contact` schema (`partner-endpoints.json .components.schemas.Contact`):
```
required: [firstName, lastName, email, phone]
properties:
  id:          string, format uuid, readOnly
  firstName:   string
  lastName:    string
  email:       string, format email
  phone:       string, format phone
  createdDate: string, readOnly
  types:       array of components.schemas.ContactType
```
And `ContactType` (`partner-endpoints.json .components.schemas.ContactType`):
```
type: object
properties:
  type:    string, enum [Admin, Billing, Technical]
  primary: boolean
```

Body-shape deltas vs spec:
- **`companyId` in body — not in spec.** Spec carries `companyId` in the path. CLI carries it in the body and uses no `companyId` in the URL. The server (if it follows the spec) would ignore the body field and have no path-level company to attach the new contact to.
- **`types` is the wrong shape.** Spec: `types: Array<{type: enum, primary: boolean}>`. CLI: `types: Array<"Admin" | "Billing" | "Technical">` (flat enum strings). A spec-strict server would reject this with 422 ("Invalid contact create" per the spec's documented error).
- **`phone` is required by spec, optional in CLI input.** Spec marks `phone` in the `Contact.required` array; the CLI command has `--phone` as `.option()` (not `.requiredOption()`) at `packages/cli/src/commands/contacts/create.ts:38`, and the Zod schema marks `phone` as `.optional()` (`packages/core/src/api/types.ts:129`).
- **No `primary` flag concept in CLI.** The spec's `ContactType.primary` indicates which contact is primary for a given type; the CLI cannot express this at all.

### Required field coverage
N/A for create — but the spec's required-field set (`firstName`, `lastName`, `email`, `phone`) is not enforced by the CLI's input contract (phone is optional). The CLI also defaults `--type` to `"Admin"` (`packages/cli/src/commands/contacts/create.ts:39`), so the `types` array is always populated client-side; but the shape it sends is wrong (see above).

### Reconciliation case
There are two reads of how the production API actually behaves; the spec is one source, observed behavior may differ:
1. **Spec-strict**: API rejects `POST /v1/contacts` with 404 (no such route) — write never lands.
2. **Undocumented compatibility route**: API accepts `POST /v1/contacts` and reads `companyId` from the body. In that case the `types` body field still doesn't match the spec's `Array<{type, primary}>` shape, so even with a friendly route, the `types` portion is unlikely to round-trip correctly. The CLI's `MockPax8Client` will of course accept whatever shape the CLI sends, so demo-mode tests don't catch any of this.

### Recommendation
Change `ContactsApi.create` to take `companyId` separately and build the path `/companies/${companyId}/contacts`; drop `companyId` from the JSON body. Reshape `types` to `Array<{type, primary}>` (with `primary` either user-controlled via new flag or defaulted false). Promote `--phone` to `requiredOption` and tighten `CreateContactInputSchema.phone` to `z.string().min(1)`.

---

## Operation: contacts update

### Wire path
CLI hits `PUT https://api.pax8.com/v1/contacts/{id}`.
- Command handler calls `ctx.api.contacts.update(id, data)` at `packages/cli/src/commands/contacts/update.ts:117`.
- `ContactsApi.update` calls `this.client.put<unknown>(\`/contacts/${id}\`, data)` at `packages/core/src/api/contacts.ts:38`.
- `client.put` issues `PUT` to `buildUrl("/contacts/${id}")` → `https://api.pax8.com/v1/contacts/{id}` (`packages/core/src/api/client.ts:95-97`, `267-278`).

The CLI never resolves a `companyId` for the update flow — it only takes the contact id as an argument (`packages/cli/src/commands/contacts/update.ts:33`) and the pre-update `get(id)` call uses the same flat path (`packages/core/src/api/contacts.ts:28`).

### Public spec location
Spec documents update at `partner-endpoints.json paths."/companies/{companyId}/contacts/{contactId}".put` (summary: "Update Contact"; `requestBody.required: true`). The spec defines **only `put`** for this path — there is no `patch` operation. Both `companyId` and `contactId` are required path params (`type: string, format: uuid`).

### Request body shape
CLI body construction (`packages/cli/src/commands/contacts/update.ts:54-81`):
```
const data: UpdateContactInput = {};
if (options.firstName) data.firstName = options.firstName;
if (options.lastName)  data.lastName  = options.lastName;
if (options.email)     data.email     = options.email;
if (options.phone)     data.phone     = options.phone;
if (options.type !== undefined) data.types = parsed as ContactType[];
```
Zod contract (`packages/core/src/api/types.ts:135-142`):
```
export const UpdateContactInputSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName:  z.string().min(1).optional(),
  email:     z.string().email().optional(),
  phone:     z.string().optional(),
  types:     z.array(ContactTypeSchema).optional(),
});
```
Spec requestBody is the same `Contact` schema as create (`partner-endpoints.json paths."/companies/{companyId}/contacts/{contactId}".put.requestBody.content."application/json".schema` → `#/components/schemas/Contact`), with the same four required scalars (`firstName`, `lastName`, `email`, `phone`) and the same nested `types: Array<{type, primary}>` shape.

Body-shape deltas vs spec:
- **Partial PUT body.** The CLI emits only the fields the user supplied on the CLI. The spec's PUT body inherits the `Contact` schema's required set (`firstName`, `lastName`, `email`, `phone`), so e.g. `pax8 contacts update <id> --email new@example.com` produces `{email: "new@example.com"}` — a body that fails the spec's required-properties contract.
- **Same `types` shape mismatch as create** — CLI sends string array, spec wants `Array<{type, primary}>`.
- **No fetch-then-merge.** The handler does call `ctx.api.contacts.get(id)` (`packages/cli/src/commands/contacts/update.ts:94`), but only to render the preview ("Current: First Last <email>") on stderr. The fetched `current` is **not merged** into the outgoing `data`. So a partial PUT is sent on the wire even though the CLI has the full prior state in memory.

### Required field coverage for update
Spec: **PUT, not PATCH** (no `.patch` key exists at `paths."/companies/{companyId}/contacts/{contactId}"`). With PUT and a required-fields body schema, the spec expects a full replacement document. The CLI does not fetch-then-merge before sending; partial bodies will fail the spec contract.

### Reconciliation case
Same two-readings frame as create:
1. **Spec-strict**: API rejects `PUT /v1/contacts/{id}` with 404 (no such route). Even if it did route there, a partial body would 422 on missing required fields.
2. **Undocumented compatibility route + partial PUT tolerated**: API might accept `PUT /v1/contacts/{id}` with a merge-patch semantic. The CLI ships as if this is true, but the `types` shape mismatch still bites.

### Recommendation
Three independent fixes are needed:
1. Path: thread `companyId` through `ContactsApi.update` (either via a new arg, or by resolving the contact's company via the prior `get(id)` response) and target `/companies/${companyId}/contacts/${contactId}`.
2. Body completeness: fetch-then-merge using the result of `ctx.api.contacts.get(id)` (which the handler already calls) so the PUT body satisfies the spec's required-fields invariant. Alternatively, request that Pax8 add a `PATCH` to the spec.
3. `types` shape: reshape to `Array<{type, primary}>`, identical to the create fix.

---

## Operation: contacts delete

### Wire path
CLI hits `DELETE https://api.pax8.com/v1/contacts/{id}`.
- Command handler calls `ctx.api.contacts.delete(id)` at `packages/cli/src/commands/contacts/delete.ts:55`.
- `ContactsApi.delete` calls `this.client.delete(\`/contacts/${id}\`)` at `packages/core/src/api/contacts.ts:43`.
- `client.delete` issues `DELETE` to `buildUrl("/contacts/${id}")` → `https://api.pax8.com/v1/contacts/{id}` (`packages/core/src/api/client.ts:103-105`, `267-278`).

### Public spec location
Spec documents deletion at `partner-endpoints.json paths."/companies/{companyId}/contacts/{contactId}".delete` (summary: "Delete Contact"; success: `204` with empty body). Both `companyId` and `contactId` are required path params. No flat `/contacts/{id}` DELETE exists in the spec.

### Request body shape
DELETE has no body (the CLI sends none — `client.delete` calls `request("DELETE", path, undefined, params)` at `packages/core/src/api/client.ts:104`). No body deltas to flag.

### Required field coverage
N/A for delete.

### Reconciliation case
1. **Spec-strict**: API rejects `DELETE /v1/contacts/{id}` with 404 — deletion never happens.
2. **Undocumented compatibility route**: API may accept the flat form and resolve the contact's company server-side, in which case behavior matches the user's intent.

The user-facing risk for delete is lower than for create/update (no body to silently corrupt), but the URL is still off-spec.

### Recommendation
Thread `companyId` through `ContactsApi.delete` and target `/companies/${companyId}/contacts/${contactId}`. The pre-delete `ctx.api.contacts.get(id)` call at `packages/cli/src/commands/contacts/delete.ts:31` already returns a `Contact` with a `companyId` field (`Contact.companyId` per `packages/core/src/api/types.ts:120`), so the handler can resolve the company id without changing its public flag surface.

---

## Constraints honored

- Read-only audit — no source files were modified.
- Every CLI claim is cited with `package/file/line` paths inside the worktree at `/tmp/pax8-cli-api-audit`.
- Every spec claim is cited by `partner-endpoints.json` path + JSON-pointer location, resolving `$ref`s explicitly.
- Request body shapes were read from `paths.*.<method>.requestBody.content."application/json".schema` (and resolved `$ref`s under `.components.schemas`), never inferred from response schemas.
- No live API calls were made.
- Worktree-relative paths used throughout.
