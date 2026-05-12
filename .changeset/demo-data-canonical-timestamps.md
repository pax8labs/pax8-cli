---
"@pax8/core": patch
---

Hotfix for typecheck regression introduced by #407. The timestamp standardization added canonical `createdAt` / `updatedAt` / `expiresAt` fields to the Zod schemas but didn't update the hand-coded interfaces in `packages/core/src/mock/demo-data.ts`. CLI command code (post-#407) reads `.createdAt` directly; TypeScript's union-narrowing across `Order | DemoOrder` (etc.) required the field on both sides, so accessing it failed with `Property 'createdAt' does not exist`. Main was broken on `pnpm -r exec tsc --noEmit` since #407 merged; `pnpm test` passed because vitest doesn't run that step.

Fix: add canonical timestamp fields to all five demo-data interfaces (Company, Subscription, Order, Quote, Webhook), duplicate the 39 fixture records to carry both names, and ensure the four `create()` methods in `MockPax8Client` populate the new fields. Also normalize `quotes.update({ expiresOn })` to set BOTH `expiresOn` AND `expiresAt` so the schema preprocess doesn't revert user updates to the stored alias value.

No public-API change. JSON output continues to emit both old and new names per #385.
