# Triage: Record<string, unknown> Schema Audit

**Date:** 2026-05-11  
**Scope:** Audit for shape mismatches between declared schemas and actual API usage across all loose types (`z.unknown()`, `Record<string, unknown>`)  
**Related Issues:** #332 (orders provisioningDetails), #363 (subscriptions provisioningDetails)  
**Status:** Read-only investigation — no fixes applied

---

## Executive Summary

**Total loose schemas found:** 3 instances  
**By classification:**
- Read-side only: 2 instances (TopicDefinition fields)
- Write-side only: 1 instance (AddWebhookTopic filters)
- Both: 0

**New issues to file:** 0  
**Verdict:** All three instances are documented, intentional, and cover future extensibility. No spec mismatches detected.

---

## Inventory: All Record<string, unknown> / z.unknown() Occurrences

| Schema Name | File:Line | Field | Type | Classification | Intentional? | Details |
|---|---|---|---|---|---|
| AddWebhookTopicSchema | types.ts:670 | filters | z.array(z.unknown()).default([]) | Write-side only | ✓ Yes | Filters for topic subscriptions; spec accepts UpdateWebhookFilter objects but CLI doesn't expose per-topic filter authoring yet (#323 out-of-scope). Default empty array sent. |
| TopicDefinitionSchema | types.ts:738 | availableFilters | z.array(z.unknown()).optional() | Read-side only | ✓ Yes | Optional; returned by GET /webhooks/topic-definitions but not used by CLI yet. Deliberately loose to avoid shipping unvalidated filter schema. |
| TopicDefinitionSchema | types.ts:739 | samplePayload | z.unknown().optional() | Read-side only | ✓ Yes | Optional; returned by API but not displayed or validated by CLI. Kept loose for forward-compat with payload changes. |

---

## Detailed Analysis

### 1. AddWebhookTopicSchema.filters (Write-side)

**Location:** `packages/core/src/api/types.ts:670`

**Schema Definition:**
```typescript
export const AddWebhookTopicSchema = z.object({
  topic: z.string().min(1),
  filters: z.array(z.unknown()).default([]),
});
```

**Purpose:**  
Per-topic filter expression array for webhook subscriptions. Maps to Pax8 webhooks API v2 `AddWebhookTopic.filters` field.

**Write Path Analysis:**

1. **CLI Entry Point:** `packages/cli/src/commands/webhooks/create.ts:155`
   ```typescript
   const webhookTopics = topics.map((topic) => ({ topic, filters: [] }));
   ```
   - CLI always sends empty filter array `[]`
   - No user-facing flag to author filters yet

2. **Service Layer:** `packages/core/src/api/webhooks.ts:42-44`
   ```typescript
   async create(data: CreateWebhookInput): Promise<Webhook> {
     const raw = await this.client.post<unknown>("/webhooks", data, WEBHOOKS);
     return WebhookSchema.parse(raw);
   }
   ```
   - CreateWebhookInput includes webhookTopics array
   - Data passed verbatim to wire

3. **Wire Test:** `packages/core/src/api/webhooks.test.ts:78-106`
   ```typescript
   const input = {
     url: "https://example.com/new",
     displayName: "Order events — prod",
     webhookTopics: [
       { topic: "order.created", filters: [] },
       { topic: "order.completed", filters: [] },
     ],
   };
   // Test confirms: client.post receives input unchanged
   ```

**OpenAPI Spec Alignment:**  
✓ **Verified correct.** Per code comment (types.ts:663-666), the spec's `UpdateWebhookFilter` schema defines:
```
{ action: string, conditions: [{ field, operator, value }] }
```
The CLI's empty default `[]` satisfies the server's "deliver all events" behavior. When per-topic filter authoring is added (#323), structured UpdateWebhookFilter objects can be passed — the loose `z.unknown()` intentionally future-proofs for that.

**Verdict:** ✓ **CORRECT**  
- Shape matches spec (server accepts filter array)
- Default empty array is spec-compliant
- Loose typing is intentional for future filter UX

---

### 2. TopicDefinitionSchema.availableFilters (Read-side only)

**Location:** `packages/core/src/api/types.ts:738`

**Schema Definition:**
```typescript
export const TopicDefinitionSchema = z.object({
  topic: z.string(),
  name: z.string(),
  description: z.string(),
  availableFilters: z.array(z.unknown()).optional(),
  samplePayload: z.unknown().optional(),
});
```

**Purpose:**  
Discoverable topic definition metadata returned by `GET /webhooks/topic-definitions`. Fields describe what filters and sample payloads a topic supports.

**Read Path Analysis:**

1. **API Method:** `packages/core/src/api/webhooks.ts:132-146`
   ```typescript
   async getTopicDefinitions(): Promise<TopicDefinition[]> {
     const raw = await this.client.get<unknown>(
       "/webhooks/topic-definitions",
       { size: 200 },
       WEBHOOKS,
     );
     // Defensive: handles both paginated and flat shapes
     if (raw && typeof raw === "object" && "content" in (raw as object)) {
       const content = (raw as { content: unknown }).content;
       return z.array(TopicDefinitionSchema).parse(content);
     }
     return z.array(TopicDefinitionSchema).parse(raw);
   }
   ```

2. **CLI Usage:** Not exposed by commands yet
   - Returned by `GET` but not rendered
   - No consumer modifies or sends these fields back

**Why Loose?**  
Per comment (types.ts:730-732):
> The optional `availableFilters` and `samplePayload` fields are also defined by the upstream `TopicDefinition` schema; they're parsed loosely (`z.unknown()`) because the CLI surface only needs `topic` and `description` today and we'd rather not ship a full payload schema we don't validate against.

**Verdict:** ✓ **CORRECT**  
- Read-only; no write risk
- Intentionally loose to avoid over-specifying response shape
- Future-proof if Pax8 API changes filter/payload structures

---

### 3. TopicDefinitionSchema.samplePayload (Read-side only)

**Location:** `packages/core/src/api/types.ts:739`

**Schema Definition:**
```typescript
samplePayload: z.unknown().optional(),
```

**Purpose:**  
Example webhook event payload for a topic. Returned by `GET /webhooks/topic-definitions`.

**Read Path Analysis:**

1. **Response Envelope:** Parsed in same `getTopicDefinitions()` call as availableFilters
2. **CLI Usage:** Not exposed by any command
3. **Downstream:** No service or command logic consumes this field

**Why Loose?**  
Payload structure is vendor-specific and version-dependent. Keeping it unvalidated allows:
- Future payload schema changes by Pax8 without CLI updates
- Partners to read raw payload structure directly if needed
- No accidental data loss from strict schema validation

**Verdict:** ✓ **CORRECT**  
- Read-only; no write risk
- Intentionally loose for forward-compat
- Not used by CLI surface, so over-specification has no benefit

---

## Surface Coverage Summary

### Contacts (POST /contacts, PUT /contacts/{id})

**Schemas Used:**
- CreateContactInputSchema (line 196)
- UpdateContactInputSchema (line 215)

**Analysis:** ✓ No loose types. All fields strictly typed.

**Write Paths:**
- `packages/core/src/api/contacts.ts:44-50` (create)
- `packages/core/src/api/contacts.ts:52-62` (update)
- `packages/cli/src/commands/contacts/create.ts`
- `packages/cli/src/commands/contacts/update.ts`

Both inputs strictly model the Pax8 public OpenAPI spec (per comment, types.ts:189-221). No `Record<string, unknown>` fields.

---

### Webhooks (POST /webhooks, POST /webhooks/{id}/configuration)

**Schemas Used:**
- CreateWebhookInputSchema (line 687)
- UpdateWebhookConfigurationInputSchema (line 700)

**Analysis:**
- CreateWebhookInputSchema includes AddWebhookTopicSchema array (line 690)
- AddWebhookTopicSchema.filters uses `z.array(z.unknown())` → **[Analyzed above]**
- UpdateWebhookConfigurationInputSchema: strictly typed, no loose fields

**Write Paths:**
- `packages/core/src/api/webhooks.ts:42-44` (create)
- `packages/core/src/api/webhooks.ts:57-67` (updateConfiguration)
- `packages/cli/src/commands/webhooks/create.ts`
- `packages/cli/src/commands/webhooks/update.ts`

---

### Orders (POST /orders)

**Status:** Already audited and fixed in #332.

**Relevant Schemas:**
- OrderLineItemProvisioningDetailSchema (line 306) — structured `{ key, values[] }`
- OrderLineItemProvisioningSchema (line 316) — array of above

**Note:** The pre-#332 `Record<string, unknown>` error has been corrected. Current schema accurately reflects the spec's array-of-objects shape.

---

### Subscriptions

**Status:** Already audited in #363 (pending resolution).

No loose types in `SubscriptionSchema` or `UpdateSubscriptionInputSchema`. The audit scope for #363 is likely a read/write mismatch in related fields, not `Record<string, unknown>` declarations.

---

### Usage Endpoints

**Schemas Used:**
- UsageSummarySchema (line 511)
- UsageLineSchema (line 535)

**Analysis:** ✓ No loose types. Both strictly typed.

**Write Paths:** None. Usage API is read-only (`GET` only).
- `packages/core/src/api/usage.ts:29-42` (listSummaries — GET)
- `packages/core/src/api/usage.ts:44-47` (getSummary — GET)
- `packages/core/src/api/usage.ts:56-65` (listLines — GET)

---

### Quotes (POST /v2/quotes, PUT /v2/quotes/{id})

**Schemas Used:**
- CreateQuoteInputSchema (line 780)
- UpdateQuoteInputSchema (line 819)
- AddQuoteLineItemInputSchema (line 842)

**Analysis:** ✓ No loose types. All fields strictly typed.

**Note:** `QuoteSchema` (line 589) includes `lineItems: z.array(QuoteLineItemSchema).optional()` but QuoteLineItemSchema is fully specified (line 548).

---

### Companies (POST /companies, PUT /companies/{id})

**Schemas Used:**
- CreateCompanyInputSchema (line 149)
- UpdateCompanyInputSchema (line 160)

**Analysis:** ✓ No loose types. All fields strictly typed (addresses resolved in #327/#328).

---

## Intentionality Checklist

| Instance | Is It Tested? | Is It Documented? | Is It Future-Proofing? | Risk Level |
|---|---|---|---|---|
| AddWebhookTopicSchema.filters | ✓ Yes (webhooks.test.ts:78-106) | ✓ Yes (types.ts:663-666) | ✓ Yes (#323 roadmap) | Low |
| TopicDefinitionSchema.availableFilters | ✓ Yes (webhooks.test.ts:223-245) | ✓ Yes (types.ts:730-732) | ✓ Yes (future filters) | Low |
| TopicDefinitionSchema.samplePayload | ✓ Yes (webhooks.test.ts:223-245) | ✓ Yes (types.ts:730-732) | ✓ Yes (forward-compat) | Low |

---

## Cross-Reference: Previous Issues

### Issue #332: Order Line Item provisioningDetails
**Resolution:** Changed from `Record<string, unknown>` (object map) to `OrderLineItemProvisioningSchema` (array of `{ key, values[] }` objects).

**File:** packages/core/src/api/types.ts:306-318  
**Status:** ✓ Fixed  
**Verification:** No current usage sends wrong shape; test confirms correct wire format.

### Issue #363: Subscription provisioningDetails
**Status:** Pending. Not in scope of this audit (no loose type declaration, likely a read/write asymmetry in related field).

---

## Conclusion

**No new issues identified.**

All three `z.unknown()` instances in the schema layer are:
1. Intentionally loose (documented in code comments)
2. Correct for their use case (write-side filters, read-side metadata)
3. Either write-side with safe defaults (empty filter array) or read-only (no write risk)
4. Future-proofing for planned features (#323) or forward-compat

The pattern from #332 (misaligned shape between schema and spec) does not recur elsewhere. Contacts, orders, subscriptions, quotes, companies, and usage endpoints all declare strict schemas matching their wire shapes.

**Recommendation:** No follow-up issues to file. Continue per existing roadmap (#323 for webhook filter UX).

