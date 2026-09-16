---
"@pax8/cli": patch
"@pax8/core": patch
---

fix(config): `config set` writes a schema-valid file, and a bad config stops blaming the API (#729)

**`pax8 config set` on a config dir with no `config.yaml` wrote a file with no `version` key.** That file fails schema validation and is discarded on every subsequent load — so the value never took effect while the command reported `✓ Set demo = true`. Reported as "`config set demo` silently does nothing"; `demo` was never the problem. Every key was affected.

Three changes, each closing a different part of the silence:

- **The version is stamped** when creating a config from scratch, or when an existing file lacks one.
- **Values are validated before they reach disk.** `pax8 config set defaults.page_size 999` now fails with `Number must be less than or equal to 100` and leaves the file byte-identical, rather than persisting an out-of-range value that poisons every later read. Keys the schema doesn't recognise are refused too — `ConfigSchema` strips unknown keys, so those previously "succeeded" and vanished on the next read. The file written is still the sparse object rather than the parsed one: parsing materializes every schema default, which would freeze today's defaults into the user's file and stop future changes reaching them.
- **A malformed config reports itself as a config problem.** `loadConfig()` let Zod's own error escape, and the CLI renderer treats a bare `ZodError` as "the Pax8 API returned an unexpected response" — so a version-less `config.yaml` produced an API error on a command that made no request:

  ```
  ✗ The Pax8 API returned an unexpected response.
    "version": expected 1.0, got undefined
  ```

  `@pax8/core` now throws a typed `ConfigValidationError` carrying the file path and the failing fields, and the CLI renders it with recovery steps that apply to a local file.

Commands still fall back to defaults when the config is unreadable — a malformed file shouldn't make every command unrunnable — but they now say so once per run on stderr, so `--json` pipelines are unaffected. Silent fallback is what let `demo: true` sit in a file while the user was told "Not authenticated".

`ConfigValidationError` and `describeConfigIssues` are new exports from `@pax8/core`; nothing else in the config surface changed.
