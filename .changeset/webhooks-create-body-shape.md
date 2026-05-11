---
"@pax8/core": patch
"@pax8/cli": patch
---

`pax8 webhooks create`: align the request body with the public Pax8 webhooks v2 OpenAPI contract. The CLI now sends `{ url, displayName, webhookTopics: [{ topic, filters }] }` instead of the pre-#323 `{ url, topics: string[] }`. A spec-strict server would 422 on the old shape (missing required `displayName`; wrong key name and element shape for the topic list).

- Adds a required `--display-name <name>` flag to `pax8 webhooks create`. Help text explains why: the Pax8 API requires it.
- Keeps the user-facing `--topics T1,T2` flag unchanged so partner scripts continue to work; the CLI transforms it into the structured `webhookTopics: [{ topic, filters: [] }]` shape at the wire layer.
- `--events` continues to work as a deprecated alias for `--topics`.

Per-topic `filters` are accepted by the spec but not yet exposed on the CLI surface — each topic ships with an empty filter array, which the server treats as "deliver every event for this topic". A structured filter-authoring UX is tracked separately.
