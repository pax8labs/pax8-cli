---
"@pax8/core": patch
---

Fix the `Pax8Client` quick-example in the README. The previous example used `client.subscriptions.listAll({...})` and `client.companies.listAll()` — methods that don't exist on the published sub-clients. The actual API is `client.subscriptions.list({...})` returning a `{ content, page }` envelope. Corrected the example, clarified the envelope shape, and listed the sub-clients that share the surface. Closes #591.
