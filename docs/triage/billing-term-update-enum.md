# `billingTerm` enum on the subscription update endpoint

**Purpose:** ground the CLI's `subscriptions update --billing-term` validation in the actual Pax8 API request-body contract, not a hand-curated subset. Source-of-truth for the [issue](https://github.com/pax8labs/pax8-cli/issues/) widening that flag.

**Verified:** 2026-05-11

## The endpoint

- **Method:** `PUT`
- **Path:** `/subscriptions/{subscriptionId}`

## The `billingTerm` enum

The `billingTerm` request-body property is restricted to one of:

| Value | Notes |
|---|---|
| `Monthly` | |
| `Annual` | |
| `2-Year` | |
| `3-Year` | |
| `One-Time` | |
| `Trial` | |
| `Activation` | |

Type: `string`. Per the spec, at least one of `price`, `billingTerm`, `quantity`, or `startDate` must be present in any update request (the spec enforces this via `anyOf` conditional requirements).

## Citation

**OpenAPI spec file:** [`https://devx.pax8.com/openapi/partner-endpoints.json`](https://devx.pax8.com/openapi/partner-endpoints.json)

**JSON path within the spec:**
```
paths./subscriptions/{subscriptionId}.put.requestBody.content.application/json.schema.allOf[1].anyOf[1].properties.billingTerm.enum
```

The schema uses `allOf` to combine a base shape with an `anyOf` conditional requirements clause (the "at-least-one-of" rule above). `billingTerm.enum` lives inside `allOf[1].anyOf[1].properties`.

## Verification method

1. Fetched the raw OpenAPI JSON from `https://devx.pax8.com/openapi/partner-endpoints.json` with `curl`.
2. Walked the `paths` tree for any `subscriptions/{...}` path with a `put` operation.
3. Read the request body's `application/json.schema`, traversing `allOf` / `anyOf` arrays to find the `billingTerm` property.
4. Extracted the `enum` array.

Reproduction:

```bash
curl -s https://devx.pax8.com/openapi/partner-endpoints.json | python3 -c "
import json, sys
spec = json.load(sys.stdin)
for path, methods in spec['paths'].items():
    if 'subscriptions' in path and '{' in path:
        for method, op in methods.items():
            if method.lower() in ('put', 'patch'):
                schema = op['requestBody']['content']['application/json']['schema']
                def walk(node, jp='schema'):
                    if not isinstance(node, dict): return
                    if 'properties' in node and 'billingTerm' in node['properties']:
                        print(method.upper(), path)
                        print('  path:', jp)
                        print('  enum:', node['properties']['billingTerm'].get('enum'))
                    for k in ('allOf','anyOf','oneOf'):
                        if k in node:
                            for i, s in enumerate(node[k]):
                                walk(s, f'{jp}.{k}[{i}]')
                walk(schema)
"
```

Output (verified 2026-05-11):
```
PUT /subscriptions/{subscriptionId}
  path: schema.allOf[1].anyOf[1].properties.billingTerm
  enum: ['Monthly', 'Annual', '2-Year', '3-Year', 'One-Time', 'Trial', 'Activation']
```

## What the CLI currently does (pre-fix)

- The shared `BillingTermSchema` in `packages/core/src/api/types.ts` already declares all 7 values — it matches the API.
- `UpdateSubscriptionInputSchema` uses `BillingTermSchema.optional()` — also matches.
- BUT: the `subscriptions update` command's `--option` help text says only `(Monthly or Annual)` and `cancel-and-reorder` is documented as the workaround for billing-term changes. There is no `.choices()` or Zod validation gating user input at the CLI layer; any string passes through to the service layer, which sends it to the API.

Net effect: the API surface is wider than the CLI's documented surface, and undocumented values like `2-Year` already silently work today.

## What this PR changes

- Help text + examples on `pax8 subscriptions update --billing-term` updated to list all 7 accepted values.
- A Zod parse against `BillingTermSchema` is added at the command layer to **fail fast on truly invalid input** (e.g., `Quarterly`, `annual` lowercased) before the API call — giving the partner a clean CLI-side error instead of an opaque API rejection.
- Existing commitment pre-flight check from #296 is unchanged: mid-commitment billing-term changes still block at the CLI layer with the actionable recovery message. That's a separate category (cross-vendor business rule the API doesn't enforce uniformly) and provides distinct value.
- README and skill.md examples updated where they imply Monthly/Annual is the full surface.

## What this PR explicitly does NOT change

- The `BillingTermSchema` enum itself (already correct).
- Other surfaces that accept `--billing-term` (orders create, quotes create, quotes line-items add). The same philosophy applies — file follow-ups if needed — but those are separate code paths and separate decisions per the issue scope.
- The API itself. If the API enum should be tightened to match vendor reality (some vendors may not accept `2-Year`, etc.), that's a Pax8 backend conversation, not CLI work.
- CLI-side prediction of which `--billing-term` values will be vendor-rejected. The CLI mirrors the API for what's available; the API surfaces vendor rejections via `ERROR_API_VALIDATION`, and the existing wrapper renders those cleanly.

## Philosophy this codifies

> **Mirror the API for what's available; pre-flight for what's known to fail.**

The CLI's contract is with the Pax8 API, not with each downstream vendor. Vendor enforcement belongs in the vendor adapter / API, not in the client. If a partner sends a value the vendor will reject, the right place for them to learn that is from the API response — clean error, honest signal — not from the CLI saying "we don't support that flag." Vendor rules drift; the API enum is relatively stable; mirroring the API means the CLI inherits Pax8's view of what's possible and updates automatically when the API does.

The existing commitment pre-flight check (#296) is the carved-out exception: a known cross-vendor business rule the API doesn't uniformly enforce, where blocking at the CLI layer with an actionable message provides clear value. That's the test for whether a CLI-side check is warranted, not "shrinking the API surface to feel safer."
