---
"@pax8/cli": patch
---

`pax8 webhooks create`: renamed `--events` to `--topics` for consistency with the API field name (`webhookTopics`) and the CLI's own `Webhook.topics[]` output schema. `--events` is preserved as a deprecated alias that still functions identically but prints a one-line deprecation notice on stderr; it will be removed in v1.0. Passing both `--topics` and `--events` simultaneously is rejected with `ERROR_INVALID_INPUT`. No-change for scripts already calling `--events`; new scripts and docs should prefer `--topics`. Refs #273.
